# Chromo Lite ✨

Welcome to Chromo Lite — the beginner-friendly, straightforward version of Chromo.

Unlike the Pro version which builds complex graphs and tracks granular chunk data, Chromo Lite uses a linear **Save -> Go Back -> Go Forward** (Undo/Redo) mechanism. Making it incredibly simple to reverse massive project changes without needing to learn any Git-like concepts.

## Requirements

1. [Deno](https://deno.land/) (v1.30+ recommended)

## Usage

Simply run Chromo Lite with all permissions in your project directory:

```bash
deno run -A index.ts
```

It will launch an interactive menu allowing you to:
1. **Save current state**: Prompt for a message and snapshot all files.
2. **Undo**: Go back one step (rewinds files to previous snapshot).
3. **Redo**: Go forward one step.
4. **View history**: See your timeline and where currently you are.

**Note on files**: 
Chromo Lite automatically ignores `.git`, `node_modules`, and its own folder `.chromolite`.

## How it works
Chromo Lite creates an internal `.chromolite` folder in your project where it stores exact copies of your files at the moment of each save. 
When you undo or redo, it forcefully rewrites the directories back to precisely that snapshot.

Enjoy the simple time travel! 🚀
