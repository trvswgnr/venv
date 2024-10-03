import { SemVer } from "@travvy/utils/misc";
import { type ParseArgsConfig } from "node:util";
import { exec } from "node:child_process";
import { execShellGet } from "./utils";
import { Result } from "@travvy/utils/result";
const NAME = "venv";
const LAST_COMMIT_HASH = await getLastCommitHash();
console.log(LAST_COMMIT_HASH);
const VERSION = SemVer.create({
    major: 0,
    minor: 0,
    patch: 1,
    metadata: LAST_COMMIT_HASH,
});

async function getLastCommitHash() {
    const result = await execShellGet(`git rev-parse --short HEAD`);
    if (Result.isErr(result)) {
        console.error(result.message);
        process.exit(1);
    }
    return result.trim();
}

export const config = {
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
    },
} as const satisfies Config;

export type Config = {
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
