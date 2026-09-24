declare module "node:fs" {
  export function readFileSync(
    path: string,
    encoding: string
  ): string;
}

declare module "node:path" {
  export function resolve(...segments: string[]): string;
}

declare const process: {
  cwd(): string;
};
