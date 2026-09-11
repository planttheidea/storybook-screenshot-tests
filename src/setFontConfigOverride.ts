import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const systemFontConfigDirectory = '/etc/fonts/conf.d';

/**
 * Shipped by fontconfig >= 2.17, this file uses config syntax (the
 * `genericfamily` property, `<const xsi:nil="true"/>`) that the older
 * fontconfig statically linked into Playwright's Chromium cannot parse.
 * Combined with the generic aliases `45-latin.conf` appends for well-known
 * families, the mis-parsed rules corrupt the match pattern, so system fonts
 * such as Georgia or Trebuchet MS silently fall back to the default font.
 */
const incompatibleConfigFileName = '48-guessfamily.conf';

/**
 * Overrides `FONTCONFIG_FILE` to point at a mirror of the host fontconfig
 * configuration without `48-guessfamily.conf`, so Playwright's bundled Chromium
 * resolves the same system fonts the host does. Test workers — and the browsers
 * they launch — inherit the runner's environment, so calling this once in global
 * setup covers the whole run.
 *
 * No-op on hosts that do not ship that file, and harmless once Playwright's
 * bundled fontconfig understands the newer syntax.
 */
export async function setFontConfigOverride(): Promise<void> {
  const fontConfigFile = await createFilteredFontConfigFile();

  if (fontConfigFile !== undefined) {
    process.env.FONTCONFIG_FILE = fontConfigFile;
  }
}

async function createFilteredFontConfigFile(): Promise<string | undefined> {
  if (!existsSync(join(systemFontConfigDirectory, incompatibleConfigFileName))) {
    return;
  }

  const configFileNames = (await readdir(systemFontConfigDirectory))
    .filter((fileName) => fileName.endsWith('.conf') && fileName !== incompatibleConfigFileName)
    .sort();

  // Content-addressed directory: a changed system config set produces a new
  // tree instead of mutating one another process may be reading.
  const contentHash = createHash('sha256').update(configFileNames.join('\n')).digest('hex').slice(0, 12);
  const rootDirectory = join(tmpdir(), `storybook-screenshots-fontconfig-${contentHash}`);
  const includeDirectory = join(rootDirectory, 'conf.d');
  const configFilePath = join(rootDirectory, 'fonts.conf');

  // `fonts.conf` is written last, so its presence marks a fully built tree.
  if (existsSync(configFilePath)) {
    return configFilePath;
  }

  await mkdir(includeDirectory, { recursive: true });

  for (const fileName of configFileNames) {
    try {
      await symlink(join(systemFontConfigDirectory, fileName), join(includeDirectory, fileName));
    } catch (error) {
      // Concurrent runs may build the same tree; the content is identical, so
      // losing the race is harmless.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  await writeFile(
    configFilePath,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/usr/share/fonts</dir>
  <dir>/usr/local/share/fonts</dir>
  <dir prefix="xdg">fonts</dir>
  <dir>~/.fonts</dir>
  <include>${includeDirectory}</include>
  <cachedir prefix="xdg">fontconfig</cachedir>
</fontconfig>
`,
  );

  return configFilePath;
}
