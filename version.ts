import { version } from "./package.json";

function getGitCommitHash() {
    const { stdout } = Bun.spawnSync({
        cmd: ["git", "rev-parse", "--short", "HEAD"],
        stdout: "pipe",
    });

    return stdout.toString().trim();
}

export function getVersion(): string {
    const hash = getGitCommitHash();
    const currentTime = new Date().getTime();
    return `${version}+${hash}.${currentTime}`;
}
