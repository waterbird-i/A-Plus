using System;
using System.IO;

namespace APlus.Tests
{
    /// <summary>
    /// Locates the repo root the same way under Unity (cwd = project root) and under
    /// `dotnet test` (cwd = bin/…), without touching UnityEngine.
    /// </summary>
    public static class TestSupport
    {
        static string _root;
        static StringTable _table;
        static GameData _data;

        public static string Root
        {
            get
            {
                if (_root == null) _root = FindRoot();
                return _root;
            }
        }

        public static string LocalizationDir { get { return Path.Combine(Root, "Assets", "Localization"); } }
        public static string DataDir { get { return Path.Combine(Root, "Assets", "Data"); } }
        public static string ScriptsDir { get { return Path.Combine(Root, "Assets", "Scripts"); } }

        public static StringTable Table
        {
            get
            {
                if (_table == null) _table = StringTable.LoadDirectory(LocalizationDir);
                return _table;
            }
        }

        public static GameData Data
        {
            get
            {
                if (_data == null) _data = GameData.Load(DataDir);
                return _data;
            }
        }

        static string FindRoot()
        {
            string[] starts = new string[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory };
            for (int s = 0; s < starts.Length; s++)
            {
                string dir = starts[s];
                for (int i = 0; i < 12 && !string.IsNullOrEmpty(dir); i++)
                {
                    if (File.Exists(Path.Combine(dir, "Assets", "Localization", "questions.csv"))) return dir;
                    DirectoryInfo parent = Directory.GetParent(dir);
                    if (parent == null) break;
                    dir = parent.FullName;
                }
            }
            throw new InvalidOperationException("repo root not found (expects Assets/Localization/questions.csv)");
        }

        /// <summary>Ticks in fixed steps; stops early on death or repel. Returns the last non-idle result.</summary>
        public static TickResult TickSeconds(GazeStateMachine m, float seconds, float dt)
        {
            TickResult last = TickResult.Idle;
            for (float el = 0f; el < seconds; el += dt)
            {
                TickResult r = m.Tick(dt);
                if (r != TickResult.Idle && r != TickResult.Safe) last = r;
                if (m.IsDead || r == TickResult.Repelled) return r;
            }
            return last;
        }
    }
}
