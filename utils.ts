import { parseArgs } from "node:util";
import { config, type Config } from "./config";
import { isObjectWithKey, SemVer } from "@travvy/utils/misc";
import fs from "node:fs";
import path from "node:path";
import { Result } from "@travvy/utils/result";
import { exec } from "node:child_process";

export const CWD = process.cwd();

type BaseCommandName = keyof typeof config.commands;
type CommandName =
    | BaseCommandName
    | {
          [K in keyof typeof config.commands]: (typeof config.commands)[K] extends {
              aliases: string[];
          }
              ? (typeof config.commands)[K]["aliases"][number]
              : never;
      }[keyof typeof config.commands];

export const getCommandName = (
    name: string | undefined,
): CommandName | null => {
    const cmdName = Object.keys(config.commands).find((k) => {
        const key = k as keyof typeof config.commands;
        if (key === name) return true;
        if (
            isObjectWithKey(config.commands[key], "aliases") &&
            Array.isArray(config.commands[key].aliases)
        ) {
            return config.commands[key].aliases.includes(name);
        }
        return false;
    });
    if (!cmdName) return null;
    return cmdName as CommandName;
};

export function parseInput<const C extends Config>(config: C): ParsedInput<C> {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        args: process.argv.slice(2),
        options: config.options,
    });

    return [values, positionals[0], positionals.slice(1)[0]] as ParsedInput<C>;
}

export type ParsedInput<C extends Config> = readonly [
    options: {
        [K in keyof C["options"]]: C["options"][K]["type"] extends "boolean"
            ? boolean
            : string;
    },
    command: string | undefined,
    arg: string | undefined,
];

export function objectKeys<T extends object>(obj: T): (keyof T)[] {
    return Object.keys(obj) as (keyof T)[];
}

export type Requirement = { name: string; version: SemVer };
export async function writeDependencies(dependencies: Array<Requirement>) {
    await fs.promises.writeFile(
        path.join(CWD, "requirements.txt"),
        dependencies
            .map((dep) => `${dep.name}==${SemVer.toString(dep.version)}`)
            .join("\n")
            .trim() + "\n",
        "utf8",
    );
}

export async function getExistingDependencies(): Promise<Array<Requirement>> {
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

export async function copyTemplateFile(
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

export function filterArray<T, U>(
    arr: T[],
    predicate: (x: any) => x is U,
): U[] {
    return arr.filter(predicate) as any;
}

export function generateHelpText(config: Config): string {
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

const venvPath = path.join(CWD, ".venv/bin/activate");
export async function withVenv(command: string, quiet = true) {
    if (!fs.existsSync(venvPath)) {
        return 1;
    }
    return await execShell(`source "${venvPath}" && ${command}`, quiet);
}
export async function withVenvGet(command: string) {
    if (!fs.existsSync(venvPath)) {
        return Result.err(new Error("No virtual environment found"));
    }
    return await execShellGet(`source "${venvPath}" && ${command}`);
}

export async function execShellGet(
    command: string,
): Promise<Result<string, Error>> {
    return await new Promise<Result<string, Error>>((resolve) => {
        try {
            const child = exec(command);
            let stdout = "";
            let stderr = "";
            child.stdout?.on("data", (data) => {
                stdout += data.toString();
            });
            child.stderr?.on("data", (data) => {
                stderr += data.toString();
            });
            child.on("exit", (code) => {
                resolve(
                    code === 0
                        ? Result.ok(stdout.trim())
                        : Result.err(new Error(stderr.trim())),
                );
            });
        } catch (err) {
            const e =
                err instanceof Error ? err : new Error("unknown exec error");
            resolve(Result.err(e));
        }
    });
}

export async function execShell(command: string, quiet = true) {
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

export function extractPackageName(
    packageSpec: string | undefined | null,
): string | null {
    // Trim whitespace and ensure input is a string
    if (typeof packageSpec !== "string") {
        return null;
    }
    packageSpec = packageSpec.trim();

    if (packageSpec.length === 0) {
        return null;
    }

    // Handle scoped packages
    if (packageSpec.startsWith("@")) {
        const scopedMatch = packageSpec.match(/^(@[\w-]+\/[\w.-]+)(?:@.*)?$/);
        if (scopedMatch) {
            return scopedMatch[1] ?? null;
        }
    }

    // Regular expression to match package names
    // Allows alphanumeric characters, hyphens, dots, and underscores
    // Stops at the first occurrence of a version specifier or special character
    const match = packageSpec.match(/^([\w.-]+)(?:[@\s=<>~^].*)?$/);

    if (match) {
        return match[1] ?? null;
    }

    // Handle URL-style package specifications
    const urlMatch = packageSpec.match(
        /^(git\+)?(https?:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+)(\.git)?(@.*)?$/,
    );
    if (urlMatch) {
        const parts = urlMatch[2]!.split("/");
        return parts[parts.length - 1] ?? null;
    }

    return null;
}
