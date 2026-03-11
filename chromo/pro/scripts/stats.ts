import { ChromoCore } from './core';
import { Chalk } from 'chalk';
const chalk = new Chalk({ level: 3 });
import { glob } from 'glob';
import { resolve, extname } from 'path';
import * as os from 'os';
import * as Diff from 'diff';

// ─── Shared Types ─────────────────────────────────────────────────────────────

interface FileRow {
    name: string;
    loc: number;
    code: number;
    docs: number;
    blank: number;
    den: number;
}

interface AnalysisResult {
    filesToProcess: string[];
    totalLoc: number;
    totalDocs: number;
    languages: Record<string, { files: number; code: number; docs: number; blank: number }>;
    largestFile: { path: string; lines: number };
    fileRows: FileRow[];
}

// ─── Shared Helpers ───────────────────────────────────────────────────────────

async function analyzeFiles(targetPath: string, options: any = {}): Promise<AnalysisResult> {
    const filesToProcess = await glob('**/*', {
        cwd: targetPath,
        ignore: ['node_modules/**', '.git/**', '.chromo/**', 'dist/**', 'build/**', 'chromo', 'chromolite', 'bun.lock'],
        nodir: true,
        absolute: true
    });

    let totalLoc = 0;
    let totalDocs = 0;
    const languages: Record<string, { files: number; code: number; docs: number; blank: number }> = {};
    let largestFile = { path: '', lines: 0 };
    const fileRows: FileRow[] = [];

    for (const filePath of filesToProcess) {
        try {
            const content = await Bun.file(filePath).text();
            if (!content) continue;

            const lines = content.split('\n');
            const loc = lines.length;
            totalLoc += loc;

            if (loc > largestFile.lines) largestFile = { path: filePath, lines: loc };

            let code = 0, docs = 0, blank = 0;
            let inBlockComment = false;

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed === '') { blank++; continue; }
                if (inBlockComment) { docs++; if (trimmed.includes('*/')) inBlockComment = false; continue; }
                if (trimmed.startsWith('/*')) { docs++; if (!trimmed.includes('*/')) inBlockComment = true; continue; }
                if (trimmed.startsWith('//')) { docs++; continue; }
                if (options.excludeBlank && trimmed === '') continue;
                code++;
            }
            totalDocs += docs;

            const ext = extname(filePath) || 'Unknown';
            let lang = 'Unknown';
            if (['.ts', '.js'].includes(ext)) lang = 'TypeScript/JS';
            else if (['.tsx', '.jsx'].includes(ext)) lang = 'React (TSX/JSX)';
            else if (['.css', '.scss'].includes(ext)) lang = 'CSS/Tailwind';
            else if (['.json', '.md', '.toml', '.yml', '.yaml'].includes(ext)) lang = 'Config/JSON/Deps';

            if (!languages[lang]) languages[lang] = { files: 0, code: 0, docs: 0, blank: 0 };
            languages[lang].files++;
            languages[lang].code += code;
            languages[lang].docs += docs;
            languages[lang].blank += blank;

            const total = code + docs + blank;
            const den = total > 0 ? Math.round((code / total) * 100) : 0;
            const name = filePath.substring(targetPath.length).replace(/^[\/\\]/, '');
            fileRows.push({ name, loc, code, docs, blank, den });

        } catch { }
    }

    return { filesToProcess, totalLoc, totalDocs, languages, largestFile, fileRows };
}

function densityBar(den: number): string {
    let barColor = chalk.green;
    if (den < 80) barColor = chalk.yellow;
    if (den < 60) barColor = chalk.red;
    const filled = Math.round(den / 25);
    const pbar = '■'.repeat(filled) + '░'.repeat(4 - filled);
    return `${chalk.white(den + '%')} [${barColor(pbar)}]`;
}

function printFileTable(fileRows: FileRow[]) {
    console.log(chalk.bold('\n📂 FILE BREAKDOWN'));
    console.log(chalk.gray('---------------------------------------------------------------------------'));
    console.log(
        chalk.bold.white('FILE'.padEnd(35)) +
        chalk.bold.white('LOC'.padEnd(7)) +
        chalk.bold.green('CODE'.padEnd(7)) +
        chalk.bold.blue('DOCS'.padEnd(7)) +
        chalk.bold.gray('BLANK'.padEnd(7)) +
        chalk.bold.white('DENSITY')
    );

    for (const row of [...fileRows].sort((a, b) => b.loc - a.loc)) {
        let name = row.name;
        if (name.length > 33) name = '...' + name.substring(name.length - 30);

        console.log(
            chalk.white(name.padEnd(35)) +
            chalk.white(row.loc.toString().padEnd(7)) +
            chalk.green(row.code.toString().padEnd(7)) +
            chalk.blue(row.docs.toString().padEnd(7)) +
            chalk.gray(row.blank.toString().padEnd(7)) +
            densityBar(row.den)
        );
    }
    console.log(chalk.gray('---------------------------------------------------------------------------'));
}

function printLanguageTable(
    languages: Record<string, { files: number; code: number; docs: number; blank: number }>,
    collectTotalDocs?: (n: number) => void
) {
    const langColor: Record<string, (s: string) => string> = {
        'TypeScript/JS': chalk.cyan,
        'React (TSX/JSX)': chalk.blueBright,
        'CSS/Tailwind': chalk.magenta,
        'Config/JSON/Deps': chalk.yellow,
        'Unknown': chalk.gray,
    };

    console.log(chalk.bold('\n📊 LANGUAGE DISTRIBUTION'));
    console.log(chalk.gray('---------------------------------------------------------------------------'));
    console.log(
        chalk.bold.white('LANGUAGE'.padEnd(18)) +
        chalk.bold.white('FILES'.padEnd(8)) +
        chalk.bold.green('CODE'.padEnd(10)) +
        chalk.bold.blue('DOCS'.padEnd(10)) +
        chalk.bold.gray('BLANK'.padEnd(10)) +
        chalk.bold.white('DENSITY')
    );

    for (const [lang, stat] of Object.entries(languages).sort((a, b) => b[1].code - a[1].code)) {
        const total = stat.code + stat.docs + stat.blank;
        if (collectTotalDocs) collectTotalDocs(stat.docs);
        const den = total > 0 ? Math.round((stat.code / total) * 100) : 0;
        const colorFn = langColor[lang] || chalk.white;

        console.log(
            colorFn(lang.padEnd(18)) +
            chalk.white(stat.files.toString().padEnd(8)) +
            chalk.green(stat.code.toLocaleString().padEnd(10)) +
            chalk.blue(stat.docs.toLocaleString().padEnd(10)) +
            chalk.gray(stat.blank.toLocaleString().padEnd(10)) +
            densityBar(den)
        );
    }
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

export async function showStats(options: any) {
    const core = new ChromoCore();

    try {
        const targetPath = process.cwd();
        const username = os.userInfo().username;
        const authorDisplay = `${username} 👤`;

        if (options.author) {
            await renderAuthorView(core, options.author, targetPath, options);
            return;
        }

        if (options.id) {
            await renderDeltaView(core, options.id, targetPath, authorDisplay);
            return;
        }

        await renderProjectHealthView(targetPath, options);

    } catch (error) {
        console.error(chalk.red('Error generating stats:'), error);
    } finally {
        core.close();
    }
}

// ─── View 1: COMPARE (--id) ───────────────────────────────────────────────────

async function renderDeltaView(core: ChromoCore, id: string, targetPath: string, authorDisplay: string) {
    const allCps = await core.listCheckpoints();
    const resolvedCp = allCps.find(c => c.id.startsWith(id));
    if (!resolvedCp) throw new Error(`Checkpoint ${id} not found`);
    const fullId = resolvedCp.id;

    const cp = await core.getCheckpoint(fullId);
    if (!cp) throw new Error(`Checkpoint ${fullId} could not be loaded`);

    console.log(`${chalk.bold.cyan('SHARPNESS: PRO 🛡️')}                          ${chalk.bold.white(`COMPARE: #${fullId.substring(0, 6)} ↔ CURRENT`)}`);

    const currentFiles = await glob('**/*', {
        cwd: targetPath,
        ignore: ['node_modules/**', '.git/**', '.chromo/**', 'dist/**', 'build/**', 'chromo', 'chromolite', 'bun.lock'],
        nodir: true,
        absolute: true
    });

    const cpFiles = cp.files.filter(f => f.path.startsWith(targetPath));
    const allFilePaths = new Set([...cpFiles.map(f => f.path), ...currentFiles]);

    let totalAdded = 0, totalRemoved = 0;
    let modifiedCount = 0, createdCount = 0, deletedCount = 0;
    const impacts: { file: string; action: string; added: number; removed: number; churn: string; owner: string }[] = [];

    for (const filePath of allFilePaths) {
        const inCp = cpFiles.find(f => f.path === filePath);
        const inCurrent = currentFiles.includes(filePath);

        let fromContent = '';
        if (inCp) {
            const buf = await core.reconstructFile(filePath, fullId);
            if (buf) fromContent = new TextDecoder('utf-8', { fatal: false }).decode(buf);
        }

        let toContent = '';
        if (inCurrent) {
            try { toContent = await Bun.file(filePath).text(); } catch { }
        }

        if (fromContent === toContent) continue;

        let action = 'MODIFIED';
        if (!inCp && inCurrent) { action = 'CREATED'; createdCount++; }
        else if (inCp && !inCurrent) { action = 'DELETED'; deletedCount++; }
        else { modifiedCount++; }

        let added = 0, removed = 0;
        const changes = Diff.diffLines(fromContent, toContent);
        for (const change of changes) {
            if (change.added) added += change.count || 0;
            if (change.removed) removed += change.count || 0;
        }

        totalAdded += added;
        totalRemoved += removed;

        const totalMod = added + removed;
        const churn = totalMod > 100 ? 'HIGH' : totalMod > 20 ? 'MED' : totalMod > 0 ? 'LOW' : 'NONE';

        impacts.push({
            file: filePath.substring(targetPath.length).replace(/^[\/\\]/, ''),
            action, added, removed, churn, owner: authorDisplay
        });
    }

    const netChange = totalAdded - totalRemoved;
    const totalTouched = totalAdded + totalRemoved || 1;
    const growthPct = ((netChange / totalTouched) * 100).toFixed(1);
    const growthLabel = netChange >= 0 ? chalk.green(`+${growthPct}% net growth`) : chalk.red(`${growthPct}% net shrink`);
    const stability = Math.max(0, 100 - (totalRemoved / totalTouched) * 100).toFixed(1) + '%';

    console.log(`${chalk.bold('STATUS:')}    ${growthLabel}                    ${chalk.bold('STABILITY:')} ${chalk.blue(stability)}`);
    console.log(chalk.gray('---------------------------------------------------------------------------'));

    console.log(chalk.bold('\n📈 DELTA SUMMARY'));
    console.log(chalk.gray('---------------------------------------------------------------------------'));
    const pAdded = Math.min(10, Math.ceil((totalAdded / totalTouched) * 10));
    const pRemoved = Math.min(10, Math.ceil((totalRemoved / totalTouched) * 10));
    const addedBar = `[${chalk.green('█'.repeat(pAdded))}${'░'.repeat(10 - pAdded)}]`;
    const removedBar = `[${chalk.red('█'.repeat(pRemoved))}${'░'.repeat(10 - pRemoved)}]`;

    console.log(`Lines Added:    ${chalk.green(`+${totalAdded}`).padEnd(8)}  ${addedBar}      Modified Files:   ${modifiedCount}`);
    console.log(`Lines Removed:  ${chalk.red(`-${totalRemoved}`).padEnd(8)}  ${removedBar}      Created Files:     ${createdCount}`);
    console.log(`Net Change:     ${(netChange >= 0 ? chalk.green(`+${netChange}`) : chalk.red(`${netChange}`)).padEnd(21)}                    Deleted Files:     ${deletedCount}`);

    console.log(chalk.bold('\n📂 IMPACT BY FILE'));
    console.log(chalk.gray('---------------------------------------------------------------------------'));
    console.log(
        chalk.bold.white('FILE PATH'.padEnd(30)) + ' ' +
        chalk.bold.white('ACTION'.padEnd(10)) + ' ' +
        chalk.bold.white('DELTA'.padEnd(13)) +
        chalk.bold.white('CHURN'.padEnd(8)) +
        chalk.bold.white('OWNER')
    );

    impacts.sort((a, b) => (b.added + b.removed) - (a.added + a.removed));

    for (const impact of impacts) {
        let name = impact.file;
        if (name.length > 28) name = '...' + name.substring(name.length - 25);

        const actionColor = impact.action === 'CREATED' ? chalk.green : impact.action === 'DELETED' ? chalk.red : chalk.yellow;
        const churnColor = impact.churn === 'HIGH' ? chalk.red : impact.churn === 'MED' ? chalk.yellow : impact.churn === 'LOW' ? chalk.green : chalk.gray;

        console.log(
            chalk.white(name.padEnd(30)) + ' ' +
            actionColor(impact.action.padEnd(10)) + ' ' +
            chalk.green(`+${impact.added}`) + '/' + chalk.red(`-${impact.removed}`) + '   ' +
            churnColor(impact.churn.padEnd(8)) + ' ' +
            impact.owner
        );
    }

    console.log(chalk.gray('---------------------------------------------------------------------------'));
    console.log(chalk.gray(`Total changed: ${impacts.length} file(s) | +${totalAdded} lines added, -${totalRemoved} lines removed`));
}

// ─── View 2: PROJECT HEALTH (default) ─────────────────────────────────────────

async function renderProjectHealthView(targetPath: string, options: any) {
    const { filesToProcess, totalLoc, totalDocs, languages, largestFile, fileRows } = await analyzeFiles(targetPath, options);

    console.log(`${chalk.bold.cyan('SHARPNESS: PRO 🛡️')}                          ${chalk.bold.white('SCOPE: PROJECT ROOT (NOW)')}`);
    console.log(`${chalk.bold('TOTAL FILES:')} ${chalk.bold.yellow(filesToProcess.length.toString())}                            ${chalk.bold('TOTAL LOC:')} ${chalk.bold.yellow(totalLoc.toLocaleString())}`);
    console.log(chalk.gray('---------------------------------------------------------------------------'));

    printLanguageTable(languages);
    printFileTable(fileRows);

    console.log(chalk.bold('\n💡 INSIGHTS'));
    console.log(chalk.gray('---------------------------------------------------------------------------'));
    const avg = filesToProcess.length > 0 ? Math.round(totalLoc / filesToProcess.length) : 0;
    const docRatio = totalLoc > 0 ? ((totalDocs / totalLoc) * 100).toFixed(1) : '0';
    const docRatioNum = parseFloat(docRatio);
    const docRatioColor = docRatioNum >= 15 ? chalk.green : docRatioNum >= 8 ? chalk.yellow : chalk.red;

    console.log(`- Average File Size: ${chalk.bold.white(avg.toString())} lines`);
    console.log(`- Documentation Ratio: ${docRatioColor(docRatio + '%')} ${docRatioNum < 15 ? chalk.gray('(Target: >15%)') : chalk.green('✓ Good')}`);
    if (largestFile.path) {
        const shortPath = largestFile.path.substring(targetPath.length).replace(/^[\/\\]/, '');
        console.log(`- Largest File: ${chalk.bold.yellow(shortPath)} ${chalk.gray('(' + largestFile.lines.toLocaleString() + ' lines)')}`);
    }
    console.log(chalk.gray('---------------------------------------------------------------------------'));
}

// ─── View 3: AUTHOR FORENSICS (--author) ──────────────────────────────────────

async function renderAuthorView(core: ChromoCore, targetAuthor: string, targetPath: string, options: any) {
    const checkpoints = await core.listCheckpoints();
    if (checkpoints.length === 0) {
        console.log('No checkpoints to analyze.');
        return;
    }

    checkpoints.sort((a, b) => a.timestamp - b.timestamp);

    let totalAdded = 0, totalRemoved = 0;
    const activeDaysSet = new Set<string>();
    const subsystems = new Map<string, number>();
    const recentDaysActivity = new Array(7).fill(0);
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const fileModTracker = new Map<string, number>();

    const SKIP_PATHS = ['node_modules', '.chromo', 'dist', 'build', 'bun.lock'];
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    const shouldSkip = (p: string) => SKIP_PATHS.some(s => p.includes(s));

    for (let i = 0; i < checkpoints.length; i++) {
        const prevCp = i > 0 ? await core.getCheckpoint(checkpoints[i - 1].id) : null;
        const cp = await core.getCheckpoint(checkpoints[i].id);
        if (!cp) continue;

        const date = new Date(cp.timestamp);
        activeDaysSet.add(date.toISOString().split('T')[0]);

        const daysAgo = Math.floor((now - cp.timestamp) / oneDay);
        if (daysAgo >= 0 && daysAgo < 7) recentDaysActivity[6 - daysAgo]++;

        const prevFileMap = prevCp ? new Map(prevCp.files.map(f => [f.path, f])) : new Map();

        for (const file of cp.files) {
            if (shouldSkip(file.path)) continue;
            if (file.size > MAX_FILE_SIZE) continue;

            fileModTracker.set(file.path, (fileModTracker.get(file.path) || 0) + 1);

            const parts = file.path.split(/[\/\\]/);
            const subsystem = parts.length > 2 ? `/${parts[parts.length - 2]}` : '/root';
            subsystems.set(subsystem, (subsystems.get(subsystem) || 0) + 1);

            const prevFile = prevFileMap.get(file.path);
            if (prevFile && prevFile.hash === file.hash) continue;

            try {
                const curBuf = await core.reconstructFile(file.path, checkpoints[i].id);
                const curLines = curBuf ? new TextDecoder('utf-8', { fatal: false }).decode(curBuf).split('\n').length : 0;

                if (prevFile) {
                    const prevBuf = await core.reconstructFile(file.path, checkpoints[i - 1].id);
                    const prevLines = prevBuf ? new TextDecoder('utf-8', { fatal: false }).decode(prevBuf).split('\n').length : 0;
                    const diff = curLines - prevLines;
                    if (diff > 0) totalAdded += diff;
                    else if (diff < 0) totalRemoved += Math.abs(diff);
                } else {
                    totalAdded += curLines;
                }
            } catch { }
        }

        if (prevCp) {
            const currFilePaths = new Set(cp.files.map(f => f.path));
            for (const prevF of prevCp.files) {
                if (currFilePaths.has(prevF.path)) continue;
                if (shouldSkip(prevF.path)) continue;
                if (prevF.size > MAX_FILE_SIZE) continue;
                try {
                    const prevBuf = await core.reconstructFile(prevF.path, checkpoints[i - 1].id);
                    const lines = prevBuf ? new TextDecoder('utf-8', { fatal: false }).decode(prevBuf).split('\n').length : 0;
                    totalRemoved += lines;
                } catch { }
            }
        }
    }

    // Email from git or fallback
    let email = `${targetAuthor}@${os.hostname()}`;
    try {
        const proc = Bun.spawnSync(['git', 'config', 'user.email']);
        const gitEmail = proc.stdout.toString().trim();
        if (gitEmail) email = gitEmail;
    } catch { }

    const snapCount = checkpoints.length;
    let rank = 'Newcomer';
    if (snapCount >= 50) rank = 'Legend';
    else if (snapCount >= 20) rank = 'Lead Contributor';
    else if (snapCount >= 10) rank = 'Active Developer';
    else if (snapCount >= 5) rank = 'Regular Contributor';

    const firstSnap = new Date(checkpoints[0].timestamp).toISOString().split('T')[0];
    const netImpact = totalAdded - totalRemoved;

    console.log(`${chalk.bold.cyan('SHARPNESS: PRO 🛡️')}                          ${chalk.bold.white(`AUTHOR: ${targetAuthor} <${email}>`)}`);
    console.log(`${chalk.bold('RANK:')}      ${chalk.magenta(rank).padEnd(26)}          ${chalk.bold('FIRST SNAP:')} ${firstSnap}`);
    console.log(chalk.gray('[ ℹ ] Chromo Pro is single-device. All history on this machine is attributed to this author.'));
    console.log(chalk.gray('---------------------------------------------------------------------------'));

    console.log(chalk.bold('\n👤 CONTRIBUTION BREAKDOWN'));
    console.log(chalk.gray('---------------------------------------------------------------------------'));
    console.log(`Total Snapshots:  ${chalk.bold.yellow(snapCount.toString()).padEnd(30)} Lines Written:   ${chalk.green(totalAdded.toLocaleString())}`);
    console.log(`Active Days:      ${chalk.bold.yellow(activeDaysSet.size.toString()).padEnd(30)} Lines Deleted:   ${chalk.red(totalRemoved.toLocaleString())}`);

    const avgAdded = Math.round(totalAdded / (snapCount || 1));
    const avgRemoved = Math.round(totalRemoved / (snapCount || 1));
    console.log(`Avg. Change Size: ${chalk.green(`+${avgAdded}`)} / ${chalk.red(`-${avgRemoved}`)}              Net Impact:      ${netImpact > 0 ? chalk.green(`+${netImpact.toLocaleString()}`) : chalk.red(netImpact.toLocaleString())}`);

    console.log(chalk.bold('\n🛠️ TOP SUBSYSTEMS (By Ownership)'));
    console.log(chalk.gray('---------------------------------------------------------------------------'));
    console.log(
        chalk.bold.white('PATH'.padEnd(26)) +
        chalk.bold.white('OWNERSHIP'.padEnd(11)) +
        chalk.bold.white('MODIFICATIONS'.padEnd(15)) +
        chalk.bold.white('ACTIVITY')
    );

    const sortedSubsystems = [...subsystems.entries()].sort((a, b) => b[1] - a[1]);
    const totalSub = Array.from(subsystems.values()).reduce((a, b) => a + b, 0) || 1;

    for (const [sub, mods] of sortedSubsystems) {
        const pct = Math.round((mods / totalSub) * 100);
        const act = pct > 40 ? '🔴 VERY HIGH' : pct > 15 ? '🟡 MEDIUM' : '⚪ LOW';
        console.log(`${sub.padEnd(26)} ${chalk.cyan(`${pct}%`).padEnd(20)} ${mods.toLocaleString().padEnd(15)} ${act}`);
    }

    console.log(chalk.bold('\n🕒 RECENT ACTIVITY TRACKER'));
    console.log(chalk.gray('---------------------------------------------------------------------------'));

    let chart = '';
    for (const val of recentDaysActivity) chart += val > 0 ? chalk.green('■') : '□';
    const actSum = recentDaysActivity.reduce((a, b) => a + b, 0);
    const heatLabel = actSum > 5 ? 'High Activity' : actSum > 0 ? 'Medium Activity' : 'Low Activity';
    console.log(`Last 7 Days: [${chart}] (${heatLabel})`);

    const hottestFile = [...fileModTracker.entries()].sort((a, b) => b[1] - a[1])[0];
    if (hottestFile) {
        const sf = hottestFile[0].split(/[\/\\]/).slice(-2).join('/');
        console.log(`Most Active File: ${chalk.bold.yellow(sf)} (Modified ${hottestFile[1]} times)`);
    }
    console.log(chalk.gray('---------------------------------------------------------------------------'));

    // ── Current workspace file health (same as root view) ──
    console.log(chalk.bold.cyan('\n📊 CURRENT WORKSPACE HEALTH'));
    const { filesToProcess, totalLoc, totalDocs, languages, largestFile, fileRows } = await analyzeFiles(targetPath, options);
    console.log(`${chalk.bold('TOTAL FILES:')} ${chalk.bold.yellow(filesToProcess.length.toString())}    ${chalk.bold('TOTAL LOC:')} ${chalk.bold.yellow(totalLoc.toLocaleString())}`);
    console.log(chalk.gray('---------------------------------------------------------------------------'));
    printLanguageTable(languages);
    printFileTable(fileRows);

    const avg = filesToProcess.length > 0 ? Math.round(totalLoc / filesToProcess.length) : 0;
    const docRatio = totalLoc > 0 ? ((totalDocs / totalLoc) * 100).toFixed(1) : '0';
    const docRatioNum = parseFloat(docRatio);
    const docRatioColor = docRatioNum >= 15 ? chalk.green : docRatioNum >= 8 ? chalk.yellow : chalk.red;
    console.log(chalk.bold('\n💡 INSIGHTS'));
    console.log(chalk.gray('---------------------------------------------------------------------------'));
    console.log(`- Average File Size: ${chalk.bold.white(avg.toString())} lines`);
    console.log(`- Documentation Ratio: ${docRatioColor(docRatio + '%')} ${docRatioNum < 15 ? chalk.gray('(Target: >15%)') : chalk.green('✓ Good')}`);
    if (largestFile.path) {
        const shortPath = largestFile.path.substring(targetPath.length).replace(/^[\/\\]/, '');
        console.log(`- Largest File: ${chalk.bold.yellow(shortPath)} ${chalk.gray('(' + largestFile.lines.toLocaleString() + ' lines)')}`);
    }
    console.log(chalk.gray('---------------------------------------------------------------------------'));
}
