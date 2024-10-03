import fs from "node:fs";
import path from "node:path";
import { SemVer, Type } from "@travvy/utils/misc";
import { Result } from "@travvy/utils/result";
import { config } from "./config";
import {
    color,
    copyTemplateFile,
    CWD,
    execShell,
    extractPackageName,
    extractPackageVersion,
    filterArray,
    generateHelpText,
    getCommandName,
    getExistingDependencies,
    objectKeys,
    parseInput,
    timed,
    withVenv,
    withVenvGet,
    writeDependencies,
} from "./utils";

await main();

async function main(): Promise<void> {
    const [options, commandNameRaw, arg] = parseInput(config);
    const commandName = getCommandName(commandNameRaw);

    for (const opt of objectKeys(options)) {
        if (options[opt]) {
            switch (opt) {
                case "help":
                    return help();
                case "version":
                    return console.log(config.version);
            }
        }
    }

    console.log(config.name, commandName, color.dim(config.version) + "\n");

    if (commandName === null) {
        return help();
    }

    const [time, res] = await timed(async () => {
        switch (commandName) {
            case "init":
                return await init();
            case "run":
                return await run(arg);
            case "install":
                return await install(arg);
            case "uninstall":
                return await uninstall(arg);
            case "list":
                return await list();
            case "update":
                return await update();
            default:
                void (commandName satisfies never);
        }
    });
    if (Type.isUndefined(res)) {
        console.log(`\n${color.dim(time + " " + "done")}`);
        return;
    }
    console.log(`\n${res} ${color.dim(time)}`);
}

async function list() {
    const result = await withVenvGet(`pip3 list`);
    if (Result.isErr(result)) {
        console.error(result.message);
        process.exit(1);
    }
    const packages: { name: string; version: SemVer }[] = [];
    const [_header, _separator, ...lines] = result.trim().split("\n");
    for (const line of lines) {
        const split = line.split(" ");
        let name = split[0];
        let version = split.at(-1);
        if (!name || !version || name.trim() === "pip") {
            continue;
        }
        const semver = SemVer.parse(version.trim());
        if (Result.isErr(semver)) {
            console.error(`Invalid semver for ${name}: ${version}`);
            process.exit(1);
        }
        packages.push({ name: name.trim(), version: semver });
    }
    console.table(
        packages.map((pkg) => ({
            name: pkg.name,
            version: SemVer.toString(pkg.version),
        })),
    );
}

async function update() {
    const result = await withVenvGet(`pip3 list --outdated`);
    if (Result.isErr(result)) {
        console.error(result.message);
        return;
    }
    const packages: {
        name: string;
        currentVersion: SemVer;
        latestVersion: SemVer;
    }[] = [];
    const [_header, _separator, ...lines] = result.trim().split("\n");
    for (const line of lines) {
        let [name, currentVersion, latestVersion, _type] = line.split(/\s+/);
        if (
            Type.isUndefined(name) ||
            Type.isUndefined(currentVersion) ||
            Type.isUndefined(latestVersion)
        ) {
            console.error(`Invalid line: ${line}`);
            process.exit(1);
        }
        if (name.trim() === "pip") {
            continue;
        }
        const currentSemver = SemVer.parse(currentVersion.trim());
        const latestSemver = SemVer.parse(latestVersion.trim());
        if (Result.isErr(currentSemver)) {
            console.error(
                `Invalid semver for ${name} (current): ${currentVersion}`,
            );
            process.exit(1);
        }
        if (Result.isErr(latestSemver)) {
            console.error(
                `Invalid semver for ${name} (latest): ${latestVersion}`,
            );
            process.exit(1);
        }
        packages.push({
            name: name.trim(),
            currentVersion: currentSemver,
            latestVersion: latestSemver,
        });
    }
    if (packages.length === 0) {
        console.log("All packages are up to date");
        return;
    }
    for (const pkg of packages) {
        await withVenv(
            `pip3 install ${pkg.name}==${SemVer.toString(pkg.latestVersion)}`,
        );
    }
    for (const pkg of packages) {
        console.log(
            `${pkg.name} ${SemVer.toString(
                pkg.currentVersion,
            )} -> ${SemVer.toString(pkg.latestVersion)}`,
        );
    }
}

async function uninstall(pkgs: string | undefined) {
    if (Type.isUndefined(pkgs)) {
        console.error("No package provided");
        return;
    }
    const pkgsArray = pkgs.split(" ");
    const promises: Promise<string | null>[] = [];
    for (const pkg of pkgsArray) {
        promises.push(uninstallOne(pkg));
    }
    const results = await Promise.all(promises);
    const names = results.filter(Type.isString);
    console.log(
        names.map((name) => `${color.bright.red("-")} ${name}`).join("\n"),
    );
    return `${names.length} package${names.length === 1 ? "" : "s"} removed`;
}

async function uninstallOne(pkg: string | undefined) {
    const pkgName = extractPackageName(pkg);
    if (!pkgName) {
        console.error("Invalid package name");
        process.exit(1);
    }
    const result = await withVenvGet(`pip3 uninstall -y ${pkgName}`);
    if (Result.isErr(result)) {
        console.error(result.message);
        process.exit(1);
    }
    if (result.includes("as it is not installed")) {
        console.log("no package found");
        process.exit(1);
    }
    const allExistingDependencies = await getExistingDependencies();
    const existingDependencies = allExistingDependencies.filter(
        (dep) => dep.name !== pkgName,
    );
    await writeDependencies(existingDependencies);
    return pkgName;
}

async function run(script: string | undefined) {
    if (!script) {
        script = "main.py";
    }
    if (!fs.existsSync(script)) {
        console.error(`${script} does not exist`);
        process.exit(1);
    }
    const exitCode = await withVenv(`python3 ${script}`, false);
    process.exit(exitCode);
}

async function install(pkgs: string | undefined) {
    if (Type.isUndefined(pkgs)) {
        // install all dependencies from requirements.txt
        console.log("Installing all dependencies from requirements.txt");
        await withVenv(`pip3 install -r requirements.txt`);
        return;
    }
    const pkgsArray = pkgs.split(" ");
    const promises: Promise<[string, string]>[] = [];
    for (const pkg of pkgsArray) {
        promises.push(installOne(pkg));
    }
    const installed = await Promise.all(promises);
    console.log(
        installed
            .map(([pkg, pkgVersion]) => {
                return `${color.bright.green("installed")} ${pkg}${color.dim(`@${pkgVersion}`)}`;
            })
            .join("\n"),
    );
    return `${color.bright.green(String(installed.length))} package${installed.length === 1 ? "" : "s"} installed`;
}

async function installOne(pkg: string): Promise<[string, string]> {
    const pkgName = extractPackageName(pkg);
    if (!pkgName) {
        console.error("Invalid package name", pkg);
        process.exit(1);
    }
    // install the package and add it to requirements.txt
    const allExistingDependencies = await getExistingDependencies();
    const existingDependencies = allExistingDependencies.filter(
        (dep) => dep.name !== pkgName,
    );
    await withVenv(`pip3 install ${pkg}`);
    const pkgVersionResult = await withVenvGet(`pip3 show ${pkgName}`);
    if (Result.isErr(pkgVersionResult)) {
        console.error(pkgVersionResult.message);
        process.exit(1);
    }
    const pkgVersion = pkgVersionResult
        .toString()
        .trim()
        .split("\n")
        .find((line) => line.startsWith("Version:"))
        ?.split(":")[1]
        ?.trim();
    if (!pkgVersion) {
        console.error(`Failed to get version for ${pkgName}`);
        process.exit(1);
    }
    const semver = SemVer.parse(pkgVersion);
    if (Result.isErr(semver)) {
        console.error(`Invalid semver for ${pkgName}: ${pkgVersion}`);
        process.exit(1);
    }
    existingDependencies.push({ name: pkgName, version: semver });
    await writeDependencies(existingDependencies);
    return [pkg, pkgVersion];
}

async function init() {
    const templateDir = path.join(__dirname, "template");
    console.log(
        "venv init helps you get started with a minimal project and tries to guess sensible defaults. Press ^C anytime to quit",
    );
    const defaultProjectName = path.basename(CWD);
    const projectName =
        prompt("Project name", defaultProjectName) ?? defaultProjectName;
    const added: string[] = [];
    const addToRollback = (relativePath: string) => {
        added.push(path.join(CWD, relativePath));
    };
    const fileCopies = filterArray(
        fs.readdirSync(templateDir),
        Type.isString,
    ).map((filename) => ({
        src: path.join(templateDir, filename),
        dest: path.join(CWD, filename),
    }));
    const promises: Promise<void>[] = [];
    for (const fileCopy of fileCopies) {
        promises.push(
            copyTemplateFile(projectName, fileCopy.src, fileCopy.dest),
        );
    }
    fileCopies.forEach((fileCopy) =>
        addToRollback(path.relative(CWD, fileCopy.dest)),
    );
    await Promise.all(promises).catch((e) => rollback(e, added, 1));

    // init python virtual environment
    let exitCode: number;

    // create virtual environment
    addToRollback(".venv");
    exitCode = await execShell(`python3 -m venv .venv`);
    if (exitCode !== 0) {
        await rollback(
            "Failed to initialize virtual environment",
            added,
            exitCode,
        );
    }

    // create requirements.txt
    addToRollback("requirements.txt");
    exitCode = await execShell("touch requirements.txt");
    if (exitCode !== 0) {
        await rollback("Failed to create requirements.txt", added, exitCode);
    }

    // create main.py
    addToRollback("main.py");
    exitCode = await execShell("touch main.py");
    if (exitCode !== 0) {
        await rollback("Failed to create main.py", added, exitCode);
    }

    // initialize git repository
    addToRollback(".git");
    exitCode = await execShell(`git init`);
    if (exitCode !== 0) {
        await rollback("Failed to initialize git repository", added, exitCode);
    }
    /*
Done! A package.json file was saved in the current directory.
 + index.ts
 + .gitignore
 + tsconfig.json (for editor auto-complete)
 + README.md

To get started, run:
  bun run index.ts
*/
    console.log(`
${color.bright.green("Done!")} A new project was created in the current directory.
 + ${color.dim("main.py")}
 + ${color.dim("requirements.txt")}
 + ${color.dim(".gitignore")}
 + ${color.dim("README.md")}

To get started, run:
  ${color.bright.cyan("venv run main.py")}`);
}

async function help() {
    console.log(generateHelpText(config));
}

async function rollback(
    e: unknown,
    addedFilesAndDirectories: string[],
    exitCode: number,
) {
    console.error(e);
    console.log("Rolling back changes...");
    for (const file of addedFilesAndDirectories) {
        await fs.promises.rm(file, { recursive: true });
    }
    process.exit(exitCode);
}
