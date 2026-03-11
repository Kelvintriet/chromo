import { Select } from "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts";
import { colors } from "https://deno.land/x/cliffy@v1.0.0-rc.3/ansi/colors.ts";

import { getDB, getCurrentIndex } from "./scripts/db.ts";
import { init, createSnapshot, undo, redo, restore, clean, viewHistory } from "./scripts/commands.ts";

async function main() {
    console.clear();
    console.log(colors.bold.magenta("✨ Welcome to Chromo Lite ✨"));
    console.log(colors.gray("Content-Addressable SQLite Backend (Fast & Compressed!)\n"));

    await init();

    while (true) {
        const db = getDB();
        const currentIndex = getCurrentIndex(db);

        const [countRow] = db.query("SELECT count(*) FROM snapshots");
        const totalSnapshots = countRow[0] as number;

        const [prevRow] = db.query("SELECT count(*) FROM snapshots WHERE id < ?", [currentIndex]);
        const hasUndo = (prevRow[0] as number) > 0;

        const [nextRow] = db.query("SELECT count(*) FROM snapshots WHERE id > ?", [currentIndex]);
        const hasRedo = (nextRow[0] as number) > 0;

        db.close();

        const actions = [
            { name: "💾 Save current state", value: "save" },
            { name: "📜 View history", value: "history" }
        ];

        if (hasUndo) {
            actions.push({ name: "⏪ Undo (Go back one step)", value: "undo" });
        }
        if (hasRedo) {
            actions.push({ name: "⏩ Redo (Go forward one step)", value: "redo" });
        }
        if (totalSnapshots > 0) {
            actions.push({ name: "🔄 Restore (Jump to a specific ID)", value: "restore" });
        }
        if (totalSnapshots > 10) {
            actions.push({ name: "🧹 Clean (Keep only last 10 saves)", value: "clean" });
        }
        actions.push({ name: "❌ Exit", value: "exit" });

        const action = await Select.prompt({
            message: "What would you like to do?",
            options: actions,
        }) as unknown as string;

        switch (action) {
            case "save":
                await createSnapshot();
                break;
            case "undo":
                await undo();
                break;
            case "redo":
                await redo();
                break;
            case "restore":
                await restore();
                break;
            case "clean":
                await clean();
                break;
            case "history":
                await viewHistory();
                break;
            case "exit":
                console.log("Goodbye! 👋");
                Deno.exit(0);
        }

        // Give some breathing room
        console.log("");
    }
}

if (import.meta.main) {
    try {
        await main();
    } catch (error) {
        if (error instanceof Error && error.message === "Prompt was canceled.") {
            console.log("\nGoodbye! 👋");
            Deno.exit(0);
        }
        console.error(colors.red("\nFatal Error:"), error);
    }
}