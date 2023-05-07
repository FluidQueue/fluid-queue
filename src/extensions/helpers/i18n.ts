import i18next from "i18next";
import FsBackend, { FsBackendOptions } from "i18next-fs-backend";
import { join, dirname as pathDirname } from "path";
import { fileURLToPath } from "url";
import { readdirSync, lstatSync } from "fs";
import { options } from "../../i18next-options.js";

const dirname = pathDirname(fileURLToPath(import.meta.url));

console.log("Initializing i18next for extensions...");
await i18next.use(FsBackend).init<FsBackendOptions>({
  ...options,
  backend: {
    ...options.backend,
    loadPath: join(dirname, "../../locales/{{lng}}/{{ns}}.json"),
    addPath: join(dirname, "../../locales/{{lng}}/{{ns}}.missing.json"),
  },
  preload: readdirSync(join(dirname, "../../locales")).filter((fileName) => {
    const joinedPath = join(join(dirname, "../../locales"), fileName);
    const isDirectory = lstatSync(joinedPath).isDirectory();
    return isDirectory;
  }),
});
