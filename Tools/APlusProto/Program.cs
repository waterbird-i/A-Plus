using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using APlus;

/// <summary>
/// 《A+》命令行原型（不需要 Unity，也不需要 .NET SDK）。
///
///   编译：powershell -ExecutionPolicy Bypass -File Tools/build-proto.ps1
///   运行：Tools/APlusProto/bin/APlusProto.exe [mode] [options]
///
/// 它干三件事：
///   1. --selftest  把 2.1 / 2.2 的设计铁律变成 22 条可执行断言（这就是「跑通原型」的证据）；
///   2. --sim       把 4.3 的三层随机跑几千轮，量出 35 道题到底能撑几轮（8.2 的缺口）；
///   3. --scan      5.5.5 要求的中文字面量扫描（C# 侧的一部分）。
/// </summary>
static class Program
{
    static int _pass;
    static int _fail;
    static readonly List<string> _failures = new List<string>();

    static int Main(string[] args)
    {
        string mode = "all";
        string rootHint = "";
        int rounds = 2000;
        int size = 9;
        int seed = 20260101;
        float noOcc = 0.45f;
        string mixText = "3,4,2";
        string modeText = "jitter";
        int jitter = 1;
        string jsonPath = "";
        string samplePath = "";
        bool demoOnly = true;

        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a.Length > 2 && a[0] == '-' && a[1] == '-')
            {
                string key = a.Substring(2);
                string val = (i + 1 < args.Length && args[i + 1].Length > 0 && args[i + 1][0] != '-') ? args[++i] : "";
                if (key == "rounds") int.TryParse(val, out rounds);
                else if (key == "size") int.TryParse(val, out size);
                else if (key == "seed") int.TryParse(val, out seed);
                else if (key == "mix") mixText = val;
                else if (key == "mode") modeText = val;
                else if (key == "jitter") int.TryParse(val, out jitter);
                else if (key == "no-occlusion") float.TryParse(val, NumberStyles.Float, CultureInfo.InvariantCulture, out noOcc);
                else if (key == "json") jsonPath = val;
                else if (key == "sample") samplePath = val;
                else if (key == "root") rootHint = val;
                else if (key == "include-nondemo") demoOnly = false;
            }
            else if (a.Length > 0 && a[0] != '-') mode = a;
        }

        string root = FindRepoRoot(rootHint);
        if (root == null)
        {
            Console.WriteLine("FAIL: cannot locate the project root (expects Assets/Localization/questions.csv).");
            return 2;
        }
        string locDir = Path.Combine(root, "Assets", "Localization");
        string dataDir = Path.Combine(root, "Assets", "Data");
        string scriptsDir = Path.Combine(root, "Assets", "Scripts");

        Console.WriteLine("A+ prototype  root=" + root);
        Console.WriteLine(new string('=', 78));

        StringTable table = StringTable.LoadDirectory(locDir);
        ScriptsSampleText = table;
        GameData data = GameData.Load(dataDir);

        bool ok = true;
        if (mode == "all" || mode == "data") ok &= DataSurface(table, data);
        if (mode == "all" || mode == "selftest") ok &= SelfTest(table, data);
        if (mode == "all" || mode == "scan") ok &= Scan(scriptsDir);
        if (mode == "all" || mode == "sim") ok &= Sim(data, rounds, size, seed, noOcc, MixSpec.Parse(mixText), demoOnly, jsonPath, samplePath, ParseMode(modeText), jitter);
        if (mode == "all" || mode == "sweep") ok &= Sweep(data, rounds, seed, noOcc, demoOnly, jsonPath);
        if (mode == "all" || mode == "modes" || mode == "sweep") ok &= ModeComparison(data, rounds, seed, noOcc, demoOnly, size, MixSpec.Parse(mixText));

        Console.WriteLine(new string('=', 78));
        Console.WriteLine(ok ? "RESULT: PASS" : "RESULT: FAIL");
        return ok ? 0 : 1;
    }

    // ---------------------------------------------------------------- data surface

    static bool DataSurface(StringTable table, GameData data)
    {
        Console.WriteLine("[1] data surface");
        Console.WriteLine("    string table rows        " + table.Count + " (" + table.Tables.Count + " csv)");
        Console.WriteLine("    answer sources           " + data.Sources.Count + " (demo " + CountDemoSources(data) + ")");
        Console.WriteLine("    occlusion states         " + data.OcclusionByLabel.Count);
        Console.WriteLine("    answer chains            " + data.Chain.Count + " (demo " + CountDemoChain(data) + ")");
        Console.WriteLine("    questions in csv         " + table.GetByPrefix("q.").Count);
        Console.WriteLine("    cross-source chains      " + CountCross(data));
        Console.WriteLine("    difficulty pool          easy " + data.CountByDifficulty(Difficulty.Easy, true)
            + " / medium " + data.CountByDifficulty(Difficulty.Medium, true)
            + " / hard " + data.CountByDifficulty(Difficulty.Hard, true));

        bool ok = true;
        ok &= ReportProblems("string table", table.Problems);
        ok &= ReportProblems("game data", data.Problems);
        ok &= ReportProblems("enum labels", data.Labels.Problems);
        Wait("data surface", ok);
        return ok;
    }

    static bool ReportProblems(string label, List<string> problems)
    {
        if (problems.Count == 0) { Console.WriteLine("    " + label + ": no problems"); return true; }
        Console.WriteLine("    " + label + ": " + problems.Count + " problem(s)");
        int shown = Math.Min(problems.Count, 12);
        for (int i = 0; i < shown; i++) Console.WriteLine("      - " + problems[i]);
        if (problems.Count > shown) Console.WriteLine("      ... " + (problems.Count - shown) + " more");
        return false;
    }

    // ---------------------------------------------------------------- self test

    static bool SelfTest(StringTable table, GameData data)
    {
        Console.WriteLine();
        Console.WriteLine("[2] prototype self-test  (design rules of 2.1 / 2.2 / 4.3 as assertions)");
        _pass = 0; _fail = 0; _failures.Clear();

        // --- 2.1 三态视线 ---
        GazeStateMachine m = new GazeStateMachine();
        for (int i = 0; i < 5; i++) m.Tick(1f);
        Check(m.Exposure == 0f, "paper accumulates no exposure (the safe zone is safe)");

        m.SetState(GazeState.LookingAround);
        for (int i = 0; i < 4; i++) m.Tick(1f);
        Check(m.Exposure > 0f && !m.PeripheralReliable, "looking-around accumulates exposure and kills peripheral vision");

        GazeStateMachine phone = new GazeStateMachine();
        phone.SetState(GazeState.Phone);
        GazeStateMachine look = new GazeStateMachine();
        look.SetState(GazeState.LookingAround);
        phone.Tick(1f); look.Tick(1f);
        Check(phone.Exposure > look.Exposure, "a glowing phone screen draws more attention than plain looking around");

        m.SetState(GazeState.Paper);
        float before = m.Exposure;
        for (int i = 0; i < 4; i++) m.Tick(1f);
        Check(m.Exposure < before, "exposure decays once you are back on the paper");

        Check(Math.Abs(m.Breathing - m.Exposure) < 0.0001f, "breathing IS the exposure variable (one auditory channel, zero HUD)");

        // --- 2.2 双重注视 ---
        GazeStateMachine t = new GazeStateMachine();
        t.InjectGaze(GazeKind.Teacher);
        for (int i = 0; i < 3; i++) t.Tick(0.5f);
        Check(t.Perceived == GazeWarning.Unknown, "the two warnings are indistinguishable for the first 2 seconds");
        t.Tick(1f);
        Check(t.Perceived == GazeWarning.Teacher, "after 2 seconds the warning becomes classifiable");

        GazeStateMachine t2 = new GazeStateMachine();
        t2.InjectGaze(GazeKind.Teacher);
        t2.SetState(GazeState.LookingAround);
        TickResult res = TickSeconds(t2, 1.0f, 0.25f);
        Check(res == TickResult.Recorded && t2.TimesRecorded == 1 && !t2.IsDead,
            "looking up under teacher gaze is a violation, and it costs a record - not death");

        TickSeconds(t2, 1.0f, 0.25f);
        Check(t2.TimesRecorded == 1, "one gaze event records once, not once per frame");

        GazeStateMachine t3 = new GazeStateMachine();
        t3.InjectGaze(GazeKind.Teacher);
        t3.SetState(GazeState.Paper);
        TickSeconds(t3, 2.0f, 0.25f);
        Check(t3.TimesRecorded == 0 && !t3.IsDead, "staying down under teacher gaze is the correct response");

        t3.InjectGaze(GazeKind.None);
        t3.InjectGaze(GazeKind.Teacher);
        t3.SetState(GazeState.LookingAround);
        TickSeconds(t3, 1.0f, 0.25f);
        Check(t3.TimesRecorded == 1, "the teacher can record you again on the next pass");

        GazeStateMachine a = new GazeStateMachine();
        a.InjectGaze(GazeKind.Anomaly);
        a.SetState(GazeState.Paper);
        res = TickSeconds(a, 1.0f, 0.25f);
        Check(res == TickResult.Died && a.IsDead, "hiding from an anomaly in the paper kills you");

        GazeStateMachine a2 = new GazeStateMachine();
        a2.InjectGaze(GazeKind.Anomaly);
        a2.SetState(GazeState.LookingAround);
        a2.SetAimingAtAnomaly(true);
        a2.Tick(0.05f);
        Check(a2.AnomalyRepelProgress > 0f, "staring back gives visible feedback from the very first tick");

        res = TickSeconds(a2, 3.0f, 0.05f);
        Check(res == TickResult.Repelled && a2.ActiveGaze == GazeKind.None, "the anomaly is repelled once you out-stare it");

        a.Tick(1f);
        Check(a.IsDead && a.State == GazeState.Paper, "a dead machine stays dead and stops taking input");

        GazeStateMachine blind = new GazeStateMachine();
        blind.InjectGaze(GazeKind.Anomaly);
        blind.SetState(GazeState.LookingAround);
        blind.SetAimingAtAnomaly(false);
        TickSeconds(blind, 3.0f, 0.25f);
        Check(!blind.IsDead && blind.AnomalyRepelProgress == 0f,
            "anomaly behind you is neutral (round 3 teaches this separately, so it must not kill early)");

        // --- 4.3 三层随机 ---
        ExamRoundGenerator gen = new ExamRoundGenerator(data);
        MixSpec mix = new MixSpec("test", 3, 4, 2);
        RoundPlan plan = gen.BuildRound(4242, 9, mix);
        Check(plan.Items.Count == 9, "round size honors the request");

        int shortfall = gen.BuildRound(1, 9, mix).Shortfall;
        Check(shortfall == 0, "the difficulty mix is realizable with the current bank (pool large enough)");

        bool dup = false;
        HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < plan.Items.Count; i++) if (!seen.Add(plan.Items[i].Chain.QId)) dup = true;
        Check(!dup, "no question repeats inside one round (drawn without replacement)");

        bool poolOk = true, occlOk = true;
        for (int i = 0; i < plan.Items.Count; i++)
        {
            PlannedItem it = plan.Items[i];
            bool found = false;
            for (int j = 0; j < it.Chain.Pools.Count; j++) if (it.Chain.Pools[j] == it.Source.Id) found = true;
            if (!found) poolOk = false;
            if (it.OcclusionLabel.Length > 0)
            {
                bool inSource = false, inChain = false;
                for (int j = 0; j < it.Source.Occlusions.Count; j++) if (it.Source.Occlusions[j] == it.OcclusionLabel) inSource = true;
                for (int j = 0; j < it.Chain.Occlusions.Count; j++) if (it.Chain.Occlusions[j] == it.OcclusionLabel) inChain = true;
                if (!inSource || !inChain) occlOk = false;
            }
        }
        Check(poolOk, "every drawn answer source is inside that question's legal pool");
        Check(occlOk, "every drawn occlusion is allowed by BOTH the question and the source");

        RoundPlan r1 = gen.BuildRound(777, 9, mix);
        RoundPlan r2 = gen.BuildRound(777, 9, mix);
        bool same = r1.Items.Count == r2.Items.Count;
        for (int i = 0; same && i < r1.Items.Count; i++)
        {
            if (r1.Items[i].Chain.QId != r2.Items[i].Chain.QId) same = false;
            if (r1.Items[i].OcclusionId != r2.Items[i].OcclusionId) same = false;
            if (r1.Items[i].Source.Id != r2.Items[i].Source.Id) same = false;
        }
        Check(same, "the same seed reproduces the exact same round (debuggable, engine-independent)");
        RoundPlan demoPlan = gen.BuildRound(31337, 9, mix);
        Check(demoPlan.NonDemoPlacements == 0, "a demo round never places an answer on a full-version-only source");

        // --- 参照完整性（C# 侧，跨两个数据目录）---
        int unmappedQ = 0;
        for (int i = 0; i < data.Chain.Count; i++)
        {
            TextRow row;
            if (!table.TryGet(data.Chain[i].QId, out row)) unmappedQ++;
        }
        Check(unmappedQ == 0, "every answer chain resolves to question text in the string table");

        bool idsOk = true;
        foreach (KeyValuePair<string, OcclusionDef> kv in data.OcclusionByLabel)
        {
            string id = kv.Value.Id;
            for (int i = 0; i < id.Length; i++)
            {
                char c = id[i];
                bool ascii = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_';
                if (!ascii) idsOk = false;
            }
        }
        Check(idsOk, "every occlusion state has an ascii id for the code side (no chinese literals in code)");

        int noBom = 0;
        noBom += CountMissingBom(data.DataDir);
        noBom += CountMissingBom(table.Dir);
        Check(noBom == 0, "every csv carries a utf-8 BOM (Excel/WPS/PowerShell must not garble chinese)");

        Console.WriteLine("    " + _pass + " passed / " + _fail + " failed");
        for (int i = 0; i < _failures.Count; i++) Console.WriteLine("      FAILED: " + _failures[i]);
        return _fail == 0;
    }

    static TickResult TickSeconds(GazeStateMachine m, float seconds, float dt)
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

    static void Check(bool condition, string label)
    {
        if (condition) { _pass++; Console.WriteLine("    ok   " + label); }
        else { _fail++; _failures.Add(label); Console.WriteLine("    FAIL " + label); }
    }

    // ---------------------------------------------------------------- scanner

    static bool Scan(string scriptsDir)
    {
        Console.WriteLine();
        Console.WriteLine("[3] hardcoded string scan  (design doc 5.5.5)");
        ScanReport report = HardcodedStringScanner.Scan(scriptsDir);
        Console.WriteLine("    files scanned            " + report.FilesScanned);
        Console.WriteLine("    literals inspected       " + report.LiteralsScanned);
        Console.WriteLine("    errors (chinese literal) " + report.Errors);
        Console.WriteLine("    warnings (log literal)   " + report.Warnings);
        for (int i = 0; i < report.Findings.Count; i++)
        {
            ScanFinding f = report.Findings[i];
            Console.WriteLine("      " + f.Severity + " " + f.Code + " " + Path.GetFileName(f.File) + ":" + f.Line + "  " + f.Detail);
        }
        bool ok = report.Errors == 0;
        Wait("scan", ok);
        return ok;
    }

    // ---------------------------------------------------------------- simulation

    static AllocationMode ParseMode(string text)
    {
        if (text == "quota") return AllocationMode.Quota;
        if (text == "weighted") return AllocationMode.Weighted;
        return AllocationMode.QuotaJitter;
    }

    static string ModeId(AllocationMode m)
    {
        if (m == AllocationMode.Quota) return "quota";
        if (m == AllocationMode.Weighted) return "weighted";
        return "jitter";
    }

    static bool Sim(GameData data, int rounds, int size, int seed, float noOcc, MixSpec mix, bool demoOnly, string jsonPath, string samplePath, AllocationMode mode, int jitter)
    {
        Console.WriteLine();
        Console.WriteLine("[4] round simulation  (design doc 4.3 / 8.2)");
        SimConfig cfg = new SimConfig();
        cfg.Rounds = rounds; cfg.Size = size; cfg.Seed = seed;
        cfg.Mix = mix; cfg.NoOcclusionProbability = noOcc; cfg.DemoOnly = demoOnly;
        cfg.Mode = mode; cfg.Jitter = jitter;

        SimResult r = RoundSimulator.Run(data, cfg);
        PrintResult(r);

        if (samplePath.Length > 0) WriteSample(data, cfg, samplePath);
        if (jsonPath.Length > 0) AppendJson(jsonPath, r);
        Wait("simulation", r.WithinRoundDuplicates == 0);
        return r.WithinRoundDuplicates == 0;
    }

    static void PrintResult(SimResult r)
    {
        Console.WriteLine("    bank                     " + r.BankSize + " questions  (pool easy " + r.PoolEasy + " / medium " + r.PoolMedium + " / hard " + r.PoolHard + ")");
        Console.WriteLine("    mix requested            " + r.Config.Mix.ToAscii() + "   mode=" + ModeId(r.Config.Mode) + (r.Config.Mode == AllocationMode.QuotaJitter ? "(jitter " + r.Config.Jitter + ")" : ""));
        Console.WriteLine("    rounds simulated         " + r.Rounds + "  seed " + r.Config.Seed);
        Console.WriteLine("    items per round          " + F(r.MeanSize));
        Console.WriteLine("    mix realized             easy " + F(r.MeanEasy) + " / medium " + F(r.MeanMedium) + " / hard " + F(r.MeanHard));
        Console.WriteLine("    rounds with shortfall    " + r.RoundsWithShortfall + " (mix could not be filled from the bank)");
        Console.WriteLine("    easy per round           min " + r.MinEasy + " max " + r.MaxEasy + "  mean abs dev " + F(r.MeanAbsEasyDev) + "   <- the per-round feel knob");
        Console.WriteLine("    phone-source items/round " + F(r.MeanPhoneItems) + "   (battery + mute pressure, 5.4)");
        Console.WriteLine("    mixed-channel items/round " + F(r.MeanMixedChannelItems));
        Console.WriteLine("    occluded items/round     " + F(r.MeanOccludedItems) + "  (" + P(r.MeanOcclusionRate) + " of items)");
        Console.WriteLine("    unresolvable occlusions  " + F(r.MeanUnresolvableItems) + " (must switch to another pool source)");
        Console.WriteLine("    non-demo placements      " + F(r.NonDemoPlacements) + " (must be 0 in demo rounds)");
        Console.WriteLine("    action steps per round   " + F(r.MeanSteps) + "  (per item min " + F(r.MeanMinSteps) + " max " + F(r.MeanMaxSteps) + ")");
        Console.WriteLine("    exposure score per round " + F(r.MeanExposure));
        Console.WriteLine();
        Console.WriteLine("    coupon collector: rounds until every question has been seen   " + F(r.MeanRoundsToSeeAll));
        Console.WriteLine("    carry-over: items repeated from the previous round             " + F(r.MeanCarryoverItems));
        Console.WriteLine("    chi2/df of question frequency                                  " + F(r.ChiSquarePerDf) + "  (1.0 = uniform)");
        Console.WriteLine("    distinct questions seen                                        " + r.DistinctQuestionsSeen + " / " + r.BankSize);
        Console.WriteLine("    duplicates inside a round                                      " + r.WithinRoundDuplicates);

        Console.Write("    steps histogram          ");
        List<int> keys = new List<int>(r.StepHistogram.Keys);
        keys.Sort();
        for (int i = 0; i < keys.Count; i++) Console.Write(keys[i] + ":" + r.StepHistogram[keys[i]] + "  ");
        Console.WriteLine();

        Console.WriteLine("    occlusions drawn         ");
        foreach (KeyValuePair<string, int> kv in SortByValue(r.OcclusionCounts))
        {
            Console.WriteLine("      " + kv.Key.PadRight(20) + kv.Value);
        }

        if (r.NeverDrawnOcclusions.Count > 0)
        {
            Console.WriteLine("    NEVER DRAWN occlusions (" + r.NeverDrawnOcclusions.Count + ") -> art work that never shows up:");
            Console.WriteLine("      " + string.Join(", ", r.NeverDrawnOcclusionIds.ToArray()));
        }
        if (r.NeverDrawnSources.Count > 0)
        {
            Console.WriteLine("    NEVER DRAWN sources (" + r.NeverDrawnSources.Count + ") -> modeled asset that never shows up:");
            Console.WriteLine("      " + string.Join(", ", r.NeverDrawnSources.ToArray()));
        }
        if (r.NeverDrawnQuestions.Count > 0)
        {
            Console.WriteLine("    NEVER DRAWN questions (" + r.NeverDrawnQuestions.Count + "):");
            Console.WriteLine("      " + string.Join(", ", r.NeverDrawnQuestions.ToArray()));
        }
    }

    static bool Sweep(GameData data, int rounds, int seed, float noOcc, bool demoOnly, string jsonPath)
    {
        Console.WriteLine();
        Console.WriteLine("[5] difficulty mix sweep  (the calibration gap: difficulty is a new column)");
        int[] sizes = new int[] { 8, 9, 10 };
        string[] mixTexts = new string[]
        {
            "3,3,2", "2,4,2", "3,4,1",
            "3,4,2", "2,4,3", "4,4,1", "3,3,3",
            "3,4,3", "2,5,3", "4,4,2", "3,5,2"
        };
        MixSpec[] mixes = new MixSpec[mixTexts.Length];
        for (int i = 0; i < mixTexts.Length; i++) mixes[i] = MixSpec.Parse(mixTexts[i]);

        List<SimResult> results = RoundSimulator.Sweep(data, rounds, seed, noOcc, sizes, mixes);

        Console.WriteLine();
        Console.WriteLine("    size mix        realized(e/m/h)  short  phone  mixed  occl%  unres  steps  expos  roundsToAll");
        for (int i = 0; i < results.Count; i++)
        {
            SimResult r = results[i];
            Console.WriteLine("    " + Pad(r.Config.Size.ToString(), 4)
                + Pad(r.Config.Mix.Name, 9)
                + Pad(F(r.MeanEasy) + "/" + F(r.MeanMedium) + "/" + F(r.MeanHard), 16)
                + Pad(r.RoundsWithShortfall.ToString(), 7)
                + Pad(F(r.MeanPhoneItems), 7)
                + Pad(F(r.MeanMixedChannelItems), 7)
                + Pad(P(r.MeanOcclusionRate), 7)
                + Pad(F(r.MeanUnresolvableItems), 7)
                + Pad(F(r.MeanSteps), 7)
                + Pad(F(r.MeanExposure), 7)
                + F(r.MeanRoundsToSeeAll));
        }

        // 「无限轮次」到底需要多少题：coupon collector 的反推。
        Console.WriteLine();
        Console.WriteLine("    bank size needed for N rounds before every question has been seen once (size 9/round):");
        int[] banks = new int[] { 35, 45, 62, 80, 100, 130 };
        for (int i = 0; i < banks.Length; i++)
        {
            double est = banks[i] * (Math.Log(banks[i]) + 0.5772) / 9.0;
            Console.WriteLine("      bank " + Pad(banks[i].ToString(), 5) + " -> about " + F(est) + " rounds");
        }

        if (jsonPath.Length > 0)
        {
            for (int i = 0; i < results.Count; i++) AppendJson(jsonPath, results[i]);
        }
        return true;
    }

    /// <summary>[6] 三种配比分配策略的实测对比 —— 这就是「配比还没实测标定」的直接答案。</summary>
    static bool ModeComparison(GameData data, int rounds, int seed, float noOcc, bool demoOnly, int size, MixSpec mix)
    {
        Console.WriteLine();
        Console.WriteLine("[6] allocation mode comparison  (quota vs jitter vs weighted)");
        Console.WriteLine("    " + size + " items/round, mix " + mix.ToAscii() + ", " + rounds + " rounds each");
        Console.WriteLine("    mode      easy min/max/dev   realizability  phone  steps  expos  chi2/df  carry  roundsToAll");

        AllocationMode[] modes = new AllocationMode[] { AllocationMode.Quota, AllocationMode.QuotaJitter, AllocationMode.Weighted };
        for (int i = 0; i < modes.Length; i++)
        {
            SimConfig cfg = new SimConfig();
            cfg.Rounds = rounds; cfg.Size = size; cfg.Seed = seed; cfg.Mix = mix;
            cfg.NoOcclusionProbability = noOcc; cfg.DemoOnly = demoOnly;
            cfg.Mode = modes[i]; cfg.Jitter = 1;
            SimResult r = RoundSimulator.Run(data, cfg);
            Console.WriteLine("    " + Pad(ModeId(modes[i]), 10)
                + Pad(r.MinEasy + "/" + r.MaxEasy + "/" + F(r.MeanAbsEasyDev), 20)
                + Pad(r.RoundsWithShortfall.ToString(), 15)
                + Pad(F(r.MeanPhoneItems), 7)
                + Pad(F(r.MeanSteps), 7)
                + Pad(F(r.MeanExposure), 7)
                + Pad(F(r.ChiSquarePerDf), 9)
                + Pad(F(r.MeanCarryoverItems), 7)
                + F(r.MeanRoundsToSeeAll));
        }
        return true;
    }

    static void WriteSample(GameData data, SimConfig cfg, string path)
    {
        ExamRoundGenerator gen = new ExamRoundGenerator(data);
        gen.DemoOnly = cfg.DemoOnly;
        gen.NoOcclusionProbability = cfg.NoOcclusionProbability;

        StringBuilder sb = new StringBuilder();
        sb.AppendLine("# 样例卷子（原型生成，seed " + cfg.Seed + "，mix " + cfg.Mix.Name + "）");
        sb.AppendLine();
        sb.AppendLine("> 由 `Tools/APlusProto` 按 4.3 的三层随机生成。用来看一轮实际长什么样。");
        sb.AppendLine("> 遮挡状态用 ASCII id 呈现；中文状态名见 `Assets/Data/occlusion_ids.csv`。");
        sb.AppendLine();
        sb.AppendLine("| # | q_id | 难度 | 题干 | 落位源 | 遮挡 | 换源? | 动作步数 | 暴露分 |");
        sb.AppendLine("|---|---|---|---|---|---|---|---|---|");

        for (int s = 0; s < 3; s++)
        {
            RoundPlan plan = gen.BuildRound(cfg.Seed + s * 101, cfg.Size, cfg.Mix);
            sb.AppendLine();
            sb.AppendLine("### 第 " + (s + 1) + " 轮（seed " + plan.Seed + "）");
            sb.AppendLine();
            for (int i = 0; i < plan.Items.Count; i++)
            {
                PlannedItem it = plan.Items[i];
                sb.Append("| " + (i + 1) + " | " + it.Chain.QId + " | " + it.DifficultyId + " | ");
                sb.Append(SampleText(it.Chain.QId));
                sb.Append(" | " + (it.Source != null ? it.Source.Id : "?"));
                sb.Append(" | " + (it.OcclusionLabel.Length > 0 ? it.OcclusionLabel + " (" + it.OcclusionId + ")" : "-"));
                sb.Append(" | " + (it.RequiresSourceSwitch ? "yes" : ""));
                sb.Append(" | " + it.ActionSteps);
                sb.AppendLine(" | " + it.ExposureScore + " |");
            }
        }
        File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
        Console.WriteLine("    sample round written to  " + path);
    }

    /// <summary>给样例卷子用：从 String Table 取题干（这里允许中文，因为它写的是输出文件，不是源码字面量）。</summary>
    static StringTable ScriptsSampleText;
    static string SampleText(string qid)
    {
        TextRow row;
        if (ScriptsSampleText != null && ScriptsSampleText.TryGet(qid, out row)) return row.Src;
        return "";
    }

    static void AppendJson(string path, SimResult r)
    {
        StringBuilder sb = new StringBuilder();
        sb.AppendLine("{");
        sb.AppendLine("  \"bankSize\": " + r.BankSize + ",");
        sb.AppendLine("  \"rounds\": " + r.Rounds + ",");
        sb.AppendLine("  \"size\": " + r.Config.Size + ",");
        sb.AppendLine("  \"mix\": \"" + r.Config.Mix.Name + "\",");
        sb.AppendLine("  \"seed\": " + r.Config.Seed + ",");
        sb.AppendLine("  \"noOcclusionProbability\": " + r.Config.NoOcclusionProbability.ToString("0.###", CultureInfo.InvariantCulture) + ",");
        sb.AppendLine("  \"meanSize\": " + Num(r.MeanSize) + ",");
        sb.AppendLine("  \"meanEasy\": " + Num(r.MeanEasy) + ",");
        sb.AppendLine("  \"meanMedium\": " + Num(r.MeanMedium) + ",");
        sb.AppendLine("  \"meanHard\": " + Num(r.MeanHard) + ",");
        sb.AppendLine("  \"roundsWithShortfall\": " + r.RoundsWithShortfall + ",");
        sb.AppendLine("  \"meanPhoneItems\": " + Num(r.MeanPhoneItems) + ",");
        sb.AppendLine("  \"meanMixedChannelItems\": " + Num(r.MeanMixedChannelItems) + ",");
        sb.AppendLine("  \"meanOccludedItems\": " + Num(r.MeanOccludedItems) + ",");
        sb.AppendLine("  \"occlusionRate\": " + Num(r.MeanOcclusionRate) + ",");
        sb.AppendLine("  \"meanUnresolvableItems\": " + Num(r.MeanUnresolvableItems) + ",");
        sb.AppendLine("  \"meanSteps\": " + Num(r.MeanSteps) + ",");
        sb.AppendLine("  \"meanExposure\": " + Num(r.MeanExposure) + ",");
        sb.AppendLine("  \"meanRoundsToSeeAll\": " + Num(r.MeanRoundsToSeeAll) + ",");
        sb.AppendLine("  \"meanCarryoverItems\": " + Num(r.MeanCarryoverItems) + ",");
        sb.AppendLine("  \"chiSquarePerDf\": " + Num(r.ChiSquarePerDf) + ",");
        sb.AppendLine("  \"neverDrawnOcclusions\": [" + JsonList(r.NeverDrawnOcclusionIds) + "],");
        sb.AppendLine("  \"neverDrawnSources\": [" + JsonList(r.NeverDrawnSources) + "]");
        sb.AppendLine("},");
        File.AppendAllText(path, sb.ToString(), new UTF8Encoding(false));
    }

    static string JsonList(List<string> items)
    {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < items.Count; i++)
        {
            if (i > 0) sb.Append(", ");
            sb.Append("\"" + items[i] + "\"");
        }
        return sb.ToString();
    }

    static string Num(double v) { return v.ToString("0.####", CultureInfo.InvariantCulture); }

    static List<KeyValuePair<string, int>> SortByValue(Dictionary<string, int> map)
    {
        List<KeyValuePair<string, int>> list = new List<KeyValuePair<string, int>>(map);
        list.Sort(delegate (KeyValuePair<string, int> a, KeyValuePair<string, int> b)
        {
            int c = b.Value.CompareTo(a.Value);
            if (c != 0) return c;
            return string.CompareOrdinal(a.Key, b.Key);
        });
        return list;
    }

    static string F(double v) { return v.ToString("0.0", CultureInfo.InvariantCulture); }
    static string P(double v) { return (v * 100.0).ToString("0", CultureInfo.InvariantCulture) + "%"; }
    static string Pad(string s, int width)
    {
        if (s.Length >= width) return s + " ";
        return s.PadRight(width);
    }

    static int CountDemoSources(GameData d)
    {
        int n = 0;
        for (int i = 0; i < d.Sources.Count; i++) if (d.Sources[i].IsDemo) n++;
        return n;
    }

    static int CountDemoChain(GameData d)
    {
        int n = 0;
        for (int i = 0; i < d.Chain.Count; i++) if (d.Chain[i].IsDemo) n++;
        return n;
    }

    static int CountCross(GameData d)
    {
        int n = 0;
        for (int i = 0; i < d.Chain.Count; i++) if (d.Chain[i].CrossSource.Length > 0) n++;
        return n;
    }

    /// <summary>
    /// 所有 CSV 都必须带 UTF-8 BOM。这不是洁癖：PowerShell 的 Get-Content 在**没有 BOM** 时
    /// 会按系统 ANSI（中文 Windows 上是 GBK）解码，中文会被读坏；而 GBK 是双字节编码，
    /// 连换行都可能被当成尾字节吃掉 —— 本项目已经因此损坏过两个文件。
    /// 加了 BOM，Excel / WPS / PowerShell / Unity 的 File.ReadAllText 就都认得。
    /// </summary>
    static int CountMissingBom(string dir)
    {
        if (dir == null || dir.Length == 0 || !Directory.Exists(dir)) return 0;
        int missing = 0;
        string[] files = Directory.GetFiles(dir, "*.csv");
        for (int i = 0; i < files.Length; i++)
        {
            byte[] head = new byte[3];
            int read;
            using (FileStream fs = File.OpenRead(files[i])) { read = fs.Read(head, 0, 3); }
            if (read < 3) { missing++; continue; }
            if (!(head[0] == 0xEF && head[1] == 0xBB && head[2] == 0xBF)) missing++;
        }
        return missing;
    }

    static void Wait(string label, bool ok)
    {
        Console.WriteLine("    -> " + label + ": " + (ok ? "PASS" : "FAIL"));
    }

    static string FindRepoRoot(string hint)
    {
        if (hint != null && hint.Length > 0 && File.Exists(Path.Combine(hint, "Assets", "Localization", "questions.csv"))) return hint;
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        for (int i = 0; i < 10 && dir != null && dir.Length > 0; i++)
        {
            if (File.Exists(Path.Combine(dir, "Assets", "Localization", "questions.csv"))) return dir;
            DirectoryInfo parent = Directory.GetParent(dir);
            if (parent == null) break;
            dir = parent.FullName;
        }
        string cwd = Directory.GetCurrentDirectory();
        string[] candidates = new string[] { cwd, Path.Combine(cwd, "A+"), Path.Combine(cwd, "..", "A+") };
        for (int i = 0; i < candidates.Length; i++)
        {
            if (File.Exists(Path.Combine(candidates[i], "Assets", "Localization", "questions.csv"))) return Path.GetFullPath(candidates[i]);
        }
        return null;
    }
}

