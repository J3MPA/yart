/* eslint-disable @typescript-eslint/naming-convention -- esbuild's and
   @electron/packager's option names, and package.json's field names. */
/**
 * Builds yart.app for one architecture, ad-hoc signed and zipped with its
 * checksum beside it.
 *
 * Usage: pnpm package:desktop [--arch arm64|x64] [--version <version>]
 *
 * Everything the app runs is bundled into a staging directory laid out as the
 * workspace is — `packages/daemon/dist/cli.mjs` where the workspace has
 * `packages/daemon/src/cli.ts` — so that the files the daemon finds relative to
 * itself, its UI and its version, are where it looks.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { packager } from '@electron/packager'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DESKTOP = join(ROOT, 'apps', 'desktop')
const OUT = join(DESKTOP, 'out')
const STAGING = join(OUT, 'staging')
const BUNDLE_ID = 'io.github.j3mpa.yart'

/**
 * Bundles that pull in CommonJS dependencies call `require`, which an ES module
 * does not have until it is made.
 */
const REQUIRE_SHIM =
  "import { createRequire as yartCreateRequire } from 'node:module'; " +
  'const require = yartCreateRequire(import.meta.url);'

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T

const run = async (command: string, args: string[], cwd = ROOT): Promise<string> =>
  (await execFileAsync(command, args, { cwd, encoding: 'utf8' })).stdout

const bundle = async (entry: string, outfile: string, external: string[] = []) => {
  await build({
    entryPoints: [join(ROOT, entry)],
    outfile: join(STAGING, outfile),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external,
    banner: { js: REQUIRE_SHIM },
    logLevel: 'warning',
  })
}

const sizeOf = async (path: string): Promise<string> =>
  `${((await stat(path)).size / 1024 / 1024).toFixed(0)} MB`

const main = async () => {
  const { values } = parseArgs({
    options: { arch: { type: 'string' }, version: { type: 'string' } },
  })
  const arch = values.arch ?? process.arch
  if (arch !== 'arm64' && arch !== 'x64') throw new Error(`Unsupported architecture: ${arch}`)
  const version =
    values.version ?? (await readJson<{ version: string }>(join(ROOT, 'package.json'))).version
  const electron_version = (
    await readJson<{ version: string }>(join(DESKTOP, 'node_modules', 'electron', 'package.json'))
  ).version
  const started = Date.now()

  // Only this architecture's output, so that building both leaves both.
  const zip_name = `yart-darwin-${arch}.zip`
  const zip_path = join(OUT, zip_name)
  for (const stale of [STAGING, join(OUT, `yart-darwin-${arch}`), zip_path, `${zip_path}.sha256`]) {
    await rm(stale, { recursive: true, force: true })
  }
  await mkdir(STAGING, { recursive: true })

  await run('pnpm', ['--filter', '@yart/web', 'build'])
  await cp(join(ROOT, 'apps', 'web', 'dist'), join(STAGING, 'apps', 'web', 'dist'), {
    recursive: true,
  })

  await bundle('packages/daemon/src/cli.ts', 'packages/daemon/dist/cli.mjs')
  await bundle('packages/mcp/src/cli.ts', 'packages/mcp/dist/cli.mjs')
  await bundle('apps/desktop/src/main.ts', 'apps/desktop/dist/main.mjs', ['electron'])
  await cp(join(DESKTOP, 'src', 'preload.cjs'), join(STAGING, 'apps/desktop/dist/preload.cjs'))

  // The daemon reports the version beside it, so it is the app's.
  await writeFile(
    join(STAGING, 'packages', 'daemon', 'package.json'),
    `${JSON.stringify({ name: '@yart/daemon', version }, null, 2)}\n`,
  )
  await writeFile(
    join(STAGING, 'package.json'),
    `${JSON.stringify(
      { name: 'yart', productName: 'yart', version, main: 'apps/desktop/dist/main.mjs' },
      null,
      2,
    )}\n`,
  )

  const [app_dir] = await packager({
    dir: STAGING,
    out: OUT,
    name: 'yart',
    platform: 'darwin',
    arch,
    electronVersion: electron_version,
    appVersion: version,
    appBundleId: BUNDLE_ID,
    asar: true,
    overwrite: true,
    protocols: [{ name: 'yart', schemes: ['yart'] }],
    // `yart uninstall` runs the uninstaller the app carries, which matches it.
    extraResource: [join(DESKTOP, 'bin'), join(DESKTOP, 'install', 'uninstall.sh')],
  })
  if (app_dir === undefined) throw new Error('Packaging produced no app')
  const app_path = join(app_dir, 'yart.app')

  // What the packager writes is only linker-signed and fails verification; an
  // ad-hoc signature over the whole bundle is what lets it open unquarantined.
  await run('codesign', ['--force', '--deep', '--sign', '-', app_path])
  await run('codesign', ['--verify', '--deep', '--strict', app_path])

  await run('ditto', ['-c', '-k', '--keepParent', app_path, zip_path])
  const digest = createHash('sha256')
    .update(await readFile(zip_path))
    .digest('hex')
  await writeFile(`${zip_path}.sha256`, `${digest}  ${zip_name}\n`)

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  process.stdout.write(
    [
      `yart ${version} for ${arch}, built in ${seconds}s`,
      `  app  ${app_path}`,
      `  zip  ${zip_path} (${await sizeOf(zip_path)})`,
      '',
    ].join('\n'),
  )
}

main().catch((cause: unknown) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = 1
})
