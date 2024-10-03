import fs from "node:fs";
import path from "node:path";
import { SemVer, Type } from "@travvy/utils/misc";
import { Result } from "@travvy/utils/result";
import { config } from "./config";
import {
    copyTemplateFile,
    CWD,
    execShell,
    extractPackageName,
    filterArray,
    generateHelpText,
    getCommandName,
    getExistingDependencies,
    objectKeys,
    parseInput,
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

    switch (commandName) {
        case "init":
            return await init();
        case "run":
            return await run(arg);
        case "install":
        case "add":
        case "i":
            return await install(arg);
        case "uninstall":
        case "remove":
        case "rm":
            return await uninstall(arg);
        case "list":
            return await list();
        case "update":
            return await update();
        case null:
            return help();
        default:
            void (commandName satisfies never);
    }
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

async function uninstall(pkg: string | undefined) {
    if (Type.isUndefined(pkg)) {
        console.error("No package provided");
        return;
    }
    const pkgName = extractPackageName(pkg);
    if (!pkgName) {
        console.error("Invalid package name");
        process.exit(1);
    }
    console.log(`Removing ${pkgName}...`);
    await withVenv(`pip3 uninstall ${pkgName}`);
    const allExistingDependencies = await getExistingDependencies();
    const existingDependencies = allExistingDependencies.filter(
        (dep) => dep.name !== pkgName,
    );
    await writeDependencies(existingDependencies);
    console.log(`Removed ${pkgName}`);
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

async function install(pkg: string | undefined) {
    if (Type.isUndefined(pkg)) {
        // install all dependencies from requirements.txt
        console.log("Installing all dependencies from requirements.txt");
        await withVenv(`pip3 install -r requirements.txt`);
        return;
    }
    const pkgName = extractPackageName(pkg);
    if (!pkgName) {
        console.error("Invalid package name");
        process.exit(1);
    }
    console.log(`Installing ${pkgName}...`);
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
        return;
    }
    const semver = SemVer.parse(pkgVersion);
    if (Result.isErr(semver)) {
        console.error(`Invalid semver for ${pkgName}: ${pkgVersion}`);
        process.exit(1);
    }
    existingDependencies.push({ name: pkgName, version: semver });
    await writeDependencies(existingDependencies);
    console.log(`Installed ${pkg}`);
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
    process.exit(1);
}

async function help() {
    console.log(generateHelpText(config));
}
