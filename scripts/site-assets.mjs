import fs from 'node:fs';
import path from 'node:path';
import { inlineCodeSpans, linkSpans, parseMd, rel } from './lib.mjs';

export const SITE_ASSET_EXTENSIONS = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.mp4',
  '.ogg',
  '.pdf',
  '.png',
  '.svg',
  '.wav',
  '.webm',
  '.webp',
]);

function isOutside(root, target) {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function parseAssetTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  if (!target || target.startsWith('#') || target.startsWith('/') || target.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(target) && !/^[a-z]:[/\\]/iu.test(target)) return null;

  target = target.split(/[?#]/u, 1)[0];
  try {
    target = decodeURIComponent(target);
  } catch {
    throw new Error(`無法解析 URL encoding：${rawTarget}`);
  }
  return SITE_ASSET_EXTENSIONS.has(path.extname(target).toLowerCase()) ? target : null;
}

export function collectReferencedSiteAssets({ repoRoot, stageRoot, markdownFiles }) {
  const root = fs.realpathSync(repoRoot);
  const copied = new Set();
  const errors = [];

  for (const markdownFile of markdownFiles) {
    const text = fs.readFileSync(markdownFile, 'utf8');
    const parsed = parseMd(text);
    for (let lineIndex = 0; lineIndex < parsed.lines.length; lineIndex++) {
      if (parsed.inFence[lineIndex]) continue;
      const line = parsed.lines[lineIndex];
      const codeSpans = inlineCodeSpans(line);
      for (const span of linkSpans(line)) {
        if (codeSpans.some((code) => span.start >= code.start && span.end <= code.end)) continue;

        let target;
        try {
          target = parseAssetTarget(span.target);
        } catch (error) {
          errors.push(`${rel(repoRoot, markdownFile)}:${lineIndex + 1} ${error.message}`);
          continue;
        }
        if (!target) continue;

        const source = path.resolve(path.dirname(markdownFile), target);
        const sourceLabel = `${rel(repoRoot, markdownFile)}:${lineIndex + 1} → ${span.target}`;
        if (isOutside(repoRoot, source)) {
          errors.push(`${sourceLabel}：路徑越界`);
          continue;
        }
        if (!fs.existsSync(source)) {
          errors.push(`${sourceLabel}：找不到本地資產`);
          continue;
        }
        const sourceReal = fs.realpathSync(source);
        if (isOutside(root, sourceReal)) {
          errors.push(`${sourceLabel}：實體路徑越界`);
          continue;
        }
        if (!fs.statSync(sourceReal).isFile()) {
          errors.push(`${sourceLabel}：目標不是檔案`);
          continue;
        }

        const relative = path.relative(repoRoot, source);
        if (copied.has(relative)) continue;
        const destination = path.join(stageRoot, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(sourceReal, destination);
        copied.add(relative);
      }
    }
  }

  if (errors.length) {
    throw new Error(`站點本地資產收集失敗：\n- ${errors.join('\n- ')}`);
  }
  return { copied: copied.size };
}
