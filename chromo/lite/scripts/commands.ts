import { Select, Input, Confirm } from "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts";
import { colors } from "https://deno.land/x/cliffy@v1.0.0-rc.3/ansi/colors.ts";
import { ensureDir } from "https://deno.land/std@0.210.0/fs/mod.ts";
import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

import { getDB, getCurrentIndex, setCurrentIndex, CHROMO_DIR } from "./db.ts";
import { compress, decompress, getFileHash, getFilesToTrack } from "./utils.ts";

export async function init() {
    await ensureDir(CHROMO_DIR);
    const db = getDB();
    db.close();
}

export async function createSnapshot() {
    const db = getDB();
    const currentIndex = getCurrentIndex(db);

    // Check total snapshots count to know if we are in "undo" state
    const [countRow] = db.query("SELECT count(*) FROM snapshots");
    const totalSnapshots = countRow[0] as number;

    const [laterCount] = db.query("SELECT count(*) FROM snapshots WHERE id > ?", [currentIndex]);
    const hasFuture = (laterCount[0] as number) > 0;

    if (totalSnapshots > 0 && hasFuture) {
        console.log(colors.yellow("⚠️  Warning: You have 'undone' to a past state."));
        console.log(colors.yellow("Creating a new save here will PERMANENTLY overwrite your forward/future saves."));
        const confirm = await Confirm.prompt("Are you sure you want to overwrite the future?");
        if (!confirm) {
            console.log(colors.red("Saved canceled."));
            db.close();
            return;
        }

        // Delete future history
        db.query("DELETE FROM snapshot_files WHERE snapshot_id > ?", [currentIndex]);
        db.query("DELETE FROM snapshots WHERE id > ?", [currentIndex]);
    }

    const message = await Input.prompt("What did you change? (Message here):");
    if (!message) {
        console.log(colors.red("Saved canceled. Message is required."));
        db.close();
        return;
    }

    const trackedFiles = await getFilesToTrack();

    console.log(colors.gray("Hashing and compressing files..."));

    // Start transaction
    db.query("BEGIN TRANSACTION");

    // Create the snapshot record
    const timestamp = Date.now();
    db.query("INSERT INTO snapshots (timestamp, message) VALUES (?, ?)", [timestamp, message]);
    const snapshotId = db.lastInsertRowId;

    for (const filePath of trackedFiles) {
        try {
            const data = await Deno.readFile(filePath);
            const hash = await getFileHash(data);

            // Check if blob exists
            const [blobExists] = db.query("SELECT count(*) FROM blobs WHERE hash = ?", [hash]);
            if ((blobExists[0] as number) === 0) {
                const compressed = await compress(data);
                db.query("INSERT INTO blobs (hash, data) VALUES (?, ?)", [hash, compressed]);
            }

            // Map file to snapshot
            db.query("INSERT INTO snapshot_files (snapshot_id, file_path, blob_hash) VALUES (?, ?, ?)", [
                snapshotId, filePath, hash
            ]);
        } catch (e) {
            console.log(colors.yellow(`Warning: Could not save file ${filePath}`));
        }
    }

    setCurrentIndex(db, snapshotId);
    db.query("COMMIT");
    db.close();

    console.log(colors.green(`\n✅ Saved state: "${message}"`));
}

async function performRestore(snapshotId: number, db: DB) {
    console.log(colors.gray("Restoring files from SQLite blobs..."));

    // Quick clear of current tracked files (to handle deletions)
    const currentFiles = await getFilesToTrack();
    for (const file of currentFiles) {
        await Deno.remove(file).catch(() => { });
    }

    // Restore files
    const rows = db.query("SELECT file_path, blob_hash FROM snapshot_files WHERE snapshot_id = ?", [snapshotId]);
    for (const [filePath, blobHash] of rows) {
        try {
            const [blobRow] = db.query("SELECT data FROM blobs WHERE hash = ?", [blobHash as string]);
            if (blobRow && blobRow[0]) {
                const compressed = blobRow[0] as Uint8Array;
                const decompressed = await decompress(compressed);

                // Recreate directories if needed
                const pathStr = filePath as string;
                const parts = pathStr.split(/[\\/]/);
                if (parts.length > 1) {
                    const dir = parts.slice(0, -1).join("/");
                    await ensureDir(dir);
                }

                await Deno.writeFile(pathStr, decompressed);
            }
        } catch (e) {
            console.log(colors.yellow(`Warning: Failed to restore ${filePath}`));
        }
    }
}

export async function undo() {
    const db = getDB();
    const currentIndex = getCurrentIndex(db);

    const rows = db.query("SELECT id, message FROM snapshots WHERE id < ? ORDER BY id DESC LIMIT 1", [currentIndex]);

    if (rows.length === 0) {
        console.log(colors.yellow("Cannot undo any further. You are at the first state or have no states."));
        db.close();
        return;
    }

    const prevId = rows[0][0] as number;
    const msg = rows[0][1] as string;

    console.log(colors.cyan(`\n⏪ Undoing to: "${msg}"...`));

    // Do the restoration
    await performRestore(prevId, db);

    setCurrentIndex(db, prevId);
    db.close();
    console.log(colors.green("✅ Project state restored successfully."));
}

export async function redo() {
    const db = getDB();
    const currentIndex = getCurrentIndex(db);

    const rows = db.query("SELECT id, message FROM snapshots WHERE id > ? ORDER BY id ASC LIMIT 1", [currentIndex]);

    if (rows.length === 0) {
        console.log(colors.yellow("Cannot redo. You are at the latest state."));
        db.close();
        return;
    }

    const nextId = rows[0][0] as number;
    const msg = rows[0][1] as string;

    console.log(colors.cyan(`\n⏩ Redoing to: "${msg}"...`));

    // Do the restoration
    await performRestore(nextId, db);

    setCurrentIndex(db, nextId);
    db.close();
    console.log(colors.green("✅ Project state restored successfully."));
}

export async function restore() {
    const db = getDB();

    const rows = db.query("SELECT id, message FROM snapshots ORDER BY id DESC LIMIT 20");
    if (rows.length === 0) {
        console.log(colors.gray("No history available to restore."));
        db.close();
        return;
    }

    const options = rows.map(([id, message]) => ({
        name: `[ID: ${id}] ${message}`,
        value: (id as number).toString()
    }));
    options.push({ name: "Cancel", value: "cancel" });

    const targetIdStr = await Select.prompt({
        message: "Select a snapshot ID to restore to:",
        options,
    }) as unknown as string;

    if (targetIdStr === "cancel") {
        db.close();
        return;
    }

    const targetId = parseInt(targetIdStr, 10);
    const [row] = db.query("SELECT message FROM snapshots WHERE id = ?", [targetId]);
    if (!row) {
        console.log(colors.red("Error: Snapshot not found."));
        db.close();
        return;
    }

    console.log(colors.cyan(`\n🔄 Restoring to: "${row[0]}"...`));

    await performRestore(targetId, db);

    setCurrentIndex(db, targetId);
    db.close();
    console.log(colors.green(`✅ Project restored to state ID ${targetId}.`));
}

export async function clean() {
    console.log(colors.yellow("⚠️  This will delete everything EXCEPT the last 5 snapshots."));
    const confirm = await Confirm.prompt("Are you sure you want to clean up old snapshots?");
    if (!confirm) {
        console.log(colors.gray("Clean canceled."));
        return;
    }

    const db = getDB();
    const [countRow] = db.query("SELECT count(*) FROM snapshots");
    const totalSnapshots = countRow[0] as number;

    if (totalSnapshots <= 5) {
        console.log(colors.green(`You only have ${totalSnapshots} snapshot(s). No cleanup needed.`));
        db.close();
        return;
    }

    db.query("BEGIN TRANSACTION");

    // Get the ID of the 10th newest snapshot
    const rows = db.query("SELECT id FROM snapshots ORDER BY id DESC LIMIT 1 OFFSET 9");
    const tenthId = rows[0][0] as number;

    // Safety check - don't delete the snapshot we are currently on if it's ancient
    const currentIndex = getCurrentIndex(db);
    if (currentIndex <= tenthId && currentIndex > 0) {
        console.log(colors.red(`You are currently at ID ${currentIndex}, but cleanup would delete everything before ID ${tenthId + 1}.`));
        console.log(colors.red("Clean aborted to prevent breaking your current active linear position."));
        db.query("ROLLBACK");
        db.close();
        return;
    }

    // Delete older snapshots
    db.query("DELETE FROM snapshot_files WHERE snapshot_id <= ?", [tenthId]);
    db.query("DELETE FROM snapshots WHERE id <= ?", [tenthId]);

    // Clean up orphaned blobs
    db.query(`
      DELETE FROM blobs WHERE hash NOT IN (
        SELECT DISTINCT blob_hash FROM snapshot_files
      )
    `);

    db.query("COMMIT");
    db.close();
    console.log(colors.green("✅ Clean completed successfully!"));
}

export async function viewHistory() {
    const db = getDB();
    const currentIndex = getCurrentIndex(db);
    const rows = db.query("SELECT id, timestamp, message FROM snapshots ORDER BY id ASC");
    db.close();

    if (rows.length === 0) {
        console.log(colors.gray("No history yet. Start by saving a state!"));
        return;
    }

    console.log(colors.bold.blue("\n📜 Chromo Lite History (File-Level SQLite Storage)\n"));

    for (const [id, timestamp, message] of [...rows].reverse()) {
        const snapId = id as number;
        const msg = message as string;
        const ts = timestamp as number;

        const isCurrent = snapId === currentIndex;
        const prefix = isCurrent ? colors.green("⮕  ") : "   ";
        const dateStr = new Date(ts).toLocaleString();

        const idStr = colors.cyan(`[ID: ${snapId}]`);

        if (isCurrent) {
            console.log(`${prefix}${colors.bold.green(msg)} ${idStr} ${colors.gray(`(${dateStr})`)} ${colors.yellow(`[CURRENT]`)}`);
        } else if (snapId > currentIndex) {
            console.log(`${prefix}${colors.gray(msg)} ${idStr} ${colors.gray(`(${dateStr}) [AHEAD]`)}`);
        } else {
            console.log(`${prefix}${colors.white(msg)} ${idStr} ${colors.gray(`(${dateStr})`)}`);
        }
    }
}
