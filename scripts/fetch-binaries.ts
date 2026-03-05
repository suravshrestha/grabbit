import { spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const GITHUB_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
const RESOURCE_DIR = 'apps/desktop/src-tauri/resources'

interface GithubAsset {
  name: string
  browser_download_url: string
}

interface GithubRelease {
  tag_name: string
  assets: GithubAsset[]
}

function detectPlatform(): { platform: NodeJS.Platform; arch: string } {
  return { platform: process.platform, arch: process.arch }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'grabbit-fetch-binaries',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch JSON from ${url}: ${response.status}`)
  }

  return (await response.json()) as T
}

async function downloadToFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(outputPath, bytes)
}

function selectYtDlpAsset(release: GithubRelease, platform: NodeJS.Platform): GithubAsset {
  if (platform === 'win32') {
    const windowsAsset = release.assets.find((asset) => asset.name === 'yt-dlp.exe')
    if (!windowsAsset) {
      throw new Error('yt-dlp.exe asset missing')
    }
    return windowsAsset
  }

  const unixAsset = release.assets.find((asset) => asset.name === 'yt-dlp')
  if (!unixAsset) {
    throw new Error('yt-dlp asset missing')
  }
  return unixAsset
}

function ffmpegUrl(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'darwin') {
    return 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip'
  }
  if (platform === 'win32') {
    return 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  }
  if (platform === 'linux') {
    if (arch === 'x64') {
      return 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'
    }
    return 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-i686-static.tar.xz'
  }
  throw new Error(`Unsupported platform: ${platform}`)
}

function archiveName(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return `grabbit-ffmpeg-${Date.now()}.tar.xz`
  }
  return `grabbit-ffmpeg-${Date.now()}.zip`
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with code ${code ?? 'unknown'}`))
      }
    })
  })
}

async function extractArchive(
  platform: NodeJS.Platform,
  archivePath: string,
  extractDir: string,
): Promise<void> {
  if (platform === 'win32') {
    await runCommand('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force`,
    ])
    return
  }

  if (platform === 'linux') {
    await runCommand('tar', ['-xJf', archivePath, '-C', extractDir])
    return
  }

  await runCommand('unzip', ['-o', archivePath, '-d', extractDir])
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

async function resolveExtractedFfmpegPath(
  platform: NodeJS.Platform,
  extractDir: string,
): Promise<string> {
  const expectedName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const files = await walkFiles(extractDir)
  const binary = files.find((path) => basename(path) === expectedName)

  if (!binary) {
    throw new Error(`Could not find ${expectedName} in extracted ffmpeg archive`)
  }

  return binary
}

async function printYtDlpVersion(binaryPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string') {
        stdout += chunk
        return
      }
      if (Buffer.isBuffer(chunk)) {
        stdout += chunk.toString()
      }
    })
    child.stderr.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string') {
        stderr += chunk
        return
      }
      if (Buffer.isBuffer(chunk)) {
        stderr += chunk.toString()
      }
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`yt-dlp --version failed (${code}): ${stderr.trim()}`))
      }
    })
  })
}

async function main(): Promise<void> {
  const { platform, arch } = detectPlatform()
  await mkdir(RESOURCE_DIR, { recursive: true })

  const release = await fetchJson<GithubRelease>(GITHUB_API)
  const ytDlpAsset = selectYtDlpAsset(release, platform)
  const ytDlpPath = join(RESOURCE_DIR, platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
  await downloadToFile(ytDlpAsset.browser_download_url, ytDlpPath)
  if (platform !== 'win32') {
    await chmod(ytDlpPath, 0o755)
  }

  const archivePath = join(tmpdir(), archiveName(platform))
  const extractDir = join(tmpdir(), `grabbit-ffmpeg-extract-${Date.now()}`)
  await mkdir(extractDir, { recursive: true })
  await downloadToFile(ffmpegUrl(platform, arch), archivePath)
  await extractArchive(platform, archivePath, extractDir)

  const extractedFfmpeg = await resolveExtractedFfmpegPath(platform, extractDir)
  const ffmpegPath = join(RESOURCE_DIR, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  await copyFile(extractedFfmpeg, ffmpegPath)
  if (platform !== 'win32') {
    await chmod(ffmpegPath, 0o755)
  }

  await rm(archivePath, { force: true })
  await rm(extractDir, { recursive: true, force: true })

  const version = await printYtDlpVersion(ytDlpPath)
  console.log(`Fetched yt-dlp ${release.tag_name} to ${ytDlpPath}`)
  console.log(`yt-dlp --version => ${version}`)
  console.log(`Fetched ffmpeg to ${ffmpegPath}`)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  console.error(message)
  process.exitCode = 1
})
