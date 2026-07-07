import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { downloadRelease, getLatestRelease, type ReleaseInfo } from '../github-configurator.js'

export interface DownloadResult {
  release: ReleaseInfo
  archivePath: string
}

/**
 * Resolve the latest Docmee release and stream it into `destDir`. Returns where
 * the archive landed plus the release metadata so later steps can log the
 * version that was installed.
 */
export async function downloadLatest(
  repo: string,
  destDir: string,
  onProgress: (percent: number) => void,
): Promise<DownloadResult> {
  const release = await getLatestRelease(repo)
  await mkdir(destDir, { recursive: true })
  const fileName = release.downloadUrl.split('/').pop() ?? `docmee-${release.version}.tar.gz`
  const archivePath = path.join(destDir, fileName)
  await downloadRelease(release.downloadUrl, archivePath, onProgress)
  return { release, archivePath }
}
