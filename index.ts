import fs from "node:fs";
import { exec } from "node:child_process";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { SemVer } from "@travvy/utils/misc";
import { Result } from "@travvy/utils/result";

const NAME = "venv";
const VERSION = SemVer.create({ major: 0, minor: 0, patch: 1 });

const config = {
    name: NAME,
    version: SemVer.toString(VERSION),
    options: {
        help: {
            type: "boolean",
            short: "h",
            default: false,
            description: "Print help text and exit",
        },
        version: {
            type: "boolean",
            short: "v",
            default: false,
            description: "Print version info and exit",
        },
    },
    commands: {
        init: {
            description: "Create an empty venv project from a blank template",
        },
        run: {
            arg: {
                name: "script",
                type: "string",
                optional: false,
                description: "Run a script in the current virtual environment",
            },
        },
        install: {
            aliases: ["add", "i"],
            arg: {
                name: "pkg",
                type: "string",
                optional: true,
                description: "Install and add a dependency to your project",
            },
            description: "Install packages in the current virtual environment",
        },
        uninstall: {
            aliases: ["remove", "rm"],
            arg: {
                name: "pkg",
                type: "string",
                optional: false,
                description:
                    "Uninstall and remove a dependency from your project",
            },
            description:
                "Uninstall packages in the current virtual environment",
        },
        list: {
            description: "List installed packages in the current project",
        },
        update: {
            description: "Update packages in the current virtual environment",
        },
        info: {
            description:
                "Show information about the current virtual environment",
        },
    },
} as const satisfies Config;

const CWD = process.cwd();

const getCommandName = (name: string | undefined): string | null => {
    const cmdName = Object.keys(config.commands).find((key) => key === name);
    if (!cmdName) return null;
    return cmdName;
};

await run();

const optionFns = {
    help,
    version: () => console.log(config.version),
} as const;

async function run(): Promise<void> {
    const [options, commandNameRaw, arg] = parseInput(config);
    const commandName = getCommandName(commandNameRaw);

    for (const opt of keys(options)) {
        if (options[opt]) {
            return optionFns[opt]();
        }
    }

    switch (commandName) {
        case "init":
            return await init();
        case "run":
            return await runScript(arg);
        case "install":
            return await install(arg);
        default:
            return help();
    }
}

function keys<T extends object>(obj: T): (keyof T)[] {
    return Object.keys(obj) as (keyof T)[];
}

async function runScript(script: string | undefined) {
    if (!script) {
        console.error("No script provided");
        return;
    }
    if (!fs.existsSync(script)) {
        console.error(`No script found at ${script}`);
        return;
    }
    await withVenv(`python3 ${script}`);
}

async function install(pkg: string | undefined) {
    if (!pkg) {
        // install all dependencies from requirements.txt
        await withVenv(`pip3 install -r requirements.txt`);
        return;
    }
    // install the package and add it to requirements.txt
    const allExistingDependencies = await getExistingDependencies();
    const existingDependencies = allExistingDependencies.filter(
        (dep) => dep.name !== pkg,
    );
    await withVenv(`pip3 install ${pkg}`);
    const pkgVersion = withVenv(`pip3 show ${pkg}`)
        .toString()
        .trim()
        .split("\n")
        .find((line) => line.startsWith("Version:"))
        ?.split(":")[1]
        ?.trim();
    if (pkgVersion) {
        const semver = SemVer.parse(pkgVersion);
        if (Result.isErr(semver)) {
            console.error(`Invalid semver: ${pkgVersion}`);
            process.exit(1);
        }
        existingDependencies.push({ name: pkg, version: semver });
    }
    await writeDependencies(existingDependencies);
}

async function writeDependencies(dependencies: Array<Requirement>) {
    await fs.promises.writeFile(
        path.join(CWD, "requirements.txt"),
        dependencies
            .map((dep) => `${dep.name}==${SemVer.toString(dep.version)}`)
            .join("\n")
            .trim() + "\n",
        "utf8",
    );
}

type Requirement = { name: string; version: SemVer };
async function getExistingDependencies(): Promise<Array<Requirement>> {
    const requirementsTxtPath = path.join(CWD, "requirements.txt");
    if (!fs.existsSync(requirementsTxtPath)) {
        console.error("No requirements.txt found");
    }
    const requirementsTxt = await fs.promises.readFile(
        requirementsTxtPath,
        "utf8",
    );
    return requirementsTxt
        .trim()
        .split("\n")
        .map((line) => {
            const [name, version] = line.split("==");
            if (!name || !version) return null;
            const semver = SemVer.parse(version);
            if (Result.isErr(semver)) {
                console.error(
                    `Invalid semver for ${name}: ${version}, skipping...`,
                );
                return null;
            }
            return { name, version: semver };
        })
        .filter((x) => x !== null);
}

async function init() {
    const templateDir = path.join(__dirname, "venv-template");
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
    const fileCopies = filter(fs.readdirSync(templateDir), isString).map(
        (filename) => ({
            src: path.join(templateDir, filename),
            dest: path.join(CWD, filename),
        }),
    );
    const promises: Promise<void>[] = [];
    for (const fileCopy of fileCopies) {
        promises.push(
            copyTemplateFile(projectName, fileCopy.src, fileCopy.dest),
        );
    }
    fileCopies.forEach((fileCopy) =>
        addToRollback(path.relative(CWD, fileCopy.dest)),
    );
    await Promise.all(promises).catch((e) => rollback(e, added));

    // init python virtual environment
    let exitCode: number;

    // create virtual environment
    addToRollback(".venv");
    exitCode = await execShell(`python3 -m venv .venv`);
    if (exitCode !== 0) {
        await rollback("Failed to initialize virtual environment", added);
    }

    // create requirements.txt
    addToRollback("requirements.txt");
    exitCode = await execShell("touch requirements.txt");
    if (exitCode !== 0) {
        await rollback("Failed to create requirements.txt", added);
    }

    // create main.py
    addToRollback("main.py");
    exitCode = await execShell("touch main.py");
    if (exitCode !== 0) {
        await rollback("Failed to create main.py", added);
    }

    // initialize git repository
    addToRollback(".git");
    exitCode = await execShell(`git init`);
    if (exitCode !== 0) {
        await rollback("Failed to initialize git repository", added);
    }
}

async function rollback(e: unknown, addedFilesAndDirectories: string[]) {
    console.error(e);
    console.log("Rolling back changes...");
    for (const file of addedFilesAndDirectories) {
        await fs.promises.rm(file, { recursive: true });
    }
    process.exit(1);
}

async function copyTemplateFile(
    projectName: string,
    src: string,
    dest: string,
) {
    const content = await fs.promises.readFile(src, "utf8");
    const newContent = content
        .replaceAll("{{project_name}}", projectName)
        .replaceAll("{{venv_version}}", config.version);
    await fs.promises.writeFile(dest, newContent, "utf8");
}

function filter<T, U>(arr: T[], predicate: (x: any) => x is U): U[] {
    return arr.filter(predicate) as any;
}

function isString(x: unknown): x is string {
    return typeof x === "string";
}

type ParsedInput<C extends Config> = readonly [
    options: {
        [K in keyof C["options"]]: C["options"][K]["type"] extends "boolean"
            ? boolean
            : string;
    },
    command: string | undefined,
    arg: string | undefined,
];

function parseInput<const C extends Config>(config: C): ParsedInput<C> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        args: process.argv.slice(2),
        options: config.options,
    });

    return [values, positionals[0], positionals.slice(1)[0]] as ParsedInput<C>;
}

async function help() {
    console.log(generateHelpText(config));
}

function generateHelpText(config: Config): string {
    let helpText =
        "venv: a virtual environment and package manager for Python\n\n";
    helpText += "Usage: venv [OPTIONS] [COMMAND]\n\n";
    const PADDING_PLACEHOLDER = "ßƒ∂";
    const PADSTART = 4;
    const PADSTARTSPACE = " ".repeat(PADSTART);

    let optionsText = "";
    // Options
    let longestOptionKey = 0;
    for (const [key, option] of Object.entries(config.options)) {
        const flagString =
            `--${key}` + (option.short ? `, -${option.short}` : "");
        optionsText += `${PADSTARTSPACE}${flagString}${PADDING_PLACEHOLDER}${option.description}\n`;
        longestOptionKey = Math.max(
            longestOptionKey,
            flagString.length + PADSTART,
        );
    }

    const format = (str: string, longest: number) =>
        str
            .split("\n")
            .map((line) =>
                line
                    .split(PADDING_PLACEHOLDER)
                    .map((part) => part.trimEnd().padEnd(longest + PADSTART))
                    .join(""),
            )
            .join("\n");

    optionsText = format(optionsText, longestOptionKey);
    helpText += "Options:\n";
    helpText += optionsText;

    // Commands
    let longestCommandKey = 0;
    let commandsText = "";
    for (const [key, command] of Object.entries(config.commands)) {
        const aliases = command.aliases
            ? `, ${command.aliases.join(", ")}`
            : "";
        let commandString = `${key}${aliases}`;
        let description = command.description;

        if (command.arg && !command.arg.optional) {
            commandString = `${key}${aliases} <${command.arg.name}>`;
            commandsText +=
                `${PADSTARTSPACE}${commandString}` +
                PADDING_PLACEHOLDER +
                `${command.arg.description}\n`;
        } else {
            commandsText +=
                `${PADSTARTSPACE}${commandString}` +
                PADDING_PLACEHOLDER +
                `${description}\n`;
            longestCommandKey = Math.max(
                longestCommandKey,
                commandString.length + PADSTART,
            );
        }
        longestCommandKey = Math.max(
            longestCommandKey,
            commandString.length + PADSTART,
        );

        // if the command has an optional argument then also add that to the help text
        if (command.arg) {
            if (command.arg.optional) {
                const argStr = `[${command.arg.name}]`;
                const cmdString = `${key}${aliases} ${argStr}`;
                commandsText +=
                    `${PADSTARTSPACE}${cmdString}` +
                    PADDING_PLACEHOLDER +
                    `${command.arg.description}\n`;
                longestCommandKey = Math.max(
                    longestCommandKey,
                    cmdString.length + PADSTART,
                );
            }
        }
    }

    helpText += "\nCommands:\n";
    commandsText = format(commandsText, longestCommandKey);
    helpText += commandsText;

    return helpText.trim();
}

type Config = {
    name: string;
    version: string;
    options: ParseArgsConfig["options"] & {
        [key: string]: { description: string };
    };
    commands: {
        [key: string]: {
            description?: string;
            aliases?: string[];
            arg?: {
                name: string;
                type: string;
                optional: boolean;
                description: string;
            };
        };
    };
};

async function withVenv(command: string) {
    const venvPath = path.join(CWD, ".venv/bin/activate");
    return await execShell(`source "${venvPath}" && ${command}`);
}

async function execShell(command: string, quiet = true) {
    return await new Promise<number>((resolve) => {
        const child = exec(command);
        if (!quiet) {
            child.stdout?.on("data", (data) => {
                process.stdout.write(data);
            });
            child.stderr?.on("data", (data) => {
                process.stderr.write(data);
            });
        }
        child.on("exit", (code) => {
            resolve(code ?? 1);
        });
    });
}
