using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;

namespace APlus.Tests
{
    /// <summary>Design doc 4.3 (three-layer randomization), 5.5.5 (string table) and data integrity.</summary>
    public class DataAndRoundTests
    {
        static readonly MixSpec Mix = new MixSpec("test", 3, 3, 3);

        [Test]
        public void DataTablesLoadWithoutProblems()
        {
            Assert.IsEmpty(TestSupport.Table.Problems, "string table");
            Assert.IsEmpty(TestSupport.Data.Problems, "game data");
            Assert.IsEmpty(TestSupport.Data.Labels.Problems, "enum labels");
        }

        [Test]
        public void EveryAnswerChainResolvesToQuestionText()
        {
            List<string> missing = new List<string>();
            foreach (AnswerChainRow c in TestSupport.Data.Chain)
            {
                TextRow row;
                if (!TestSupport.Table.TryGet(c.QId, out row)) missing.Add(c.QId);
            }
            Assert.IsEmpty(missing);
        }

        [Test]
        public void HiddenEnglishClauseQuestionMatchesTheClauseItself()
        {
            TextRow clause;
            Assert.IsTrue(TestSupport.Table.TryGet("world.rule.hidden_07", out clause));
            string firstWord = clause.Src.Split(' ')[0];
            AnswerChainRow row = null;
            foreach (AnswerChainRow c in TestSupport.Data.Chain)
                if (c.QId == "q.fill.28") row = c;
            Assert.IsNotNull(row);
            Assert.AreEqual(firstWord, row.Answer);
        }

        [Test]
        public void EveryOcclusionHasAnAsciiId()
        {
            foreach (OcclusionDef def in TestSupport.Data.OcclusionByLabel.Values)
            {
                foreach (char c in def.Id)
                {
                    bool ascii = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_';
                    Assert.IsTrue(ascii, def.Id);
                }
            }
        }

        [Test]
        public void EveryCsvCarriesAUtf8Bom()
        {
            List<string> missing = new List<string>();
            string[] dirs = new string[] { TestSupport.DataDir, TestSupport.LocalizationDir };
            foreach (string dir in dirs)
            {
                foreach (string file in Directory.GetFiles(dir, "*.csv"))
                {
                    byte[] head = new byte[3];
                    int read;
                    using (FileStream fs = File.OpenRead(file)) { read = fs.Read(head, 0, 3); }
                    if (read < 3 || head[0] != 0xEF || head[1] != 0xBB || head[2] != 0xBF) missing.Add(Path.GetFileName(file));
                }
            }
            Assert.IsEmpty(missing);
        }

        [Test]
        public void NoChineseLiteralsInScripts()
        {
            ScanReport report = HardcodedStringScanner.Scan(TestSupport.ScriptsDir);
            List<string> errors = new List<string>();
            foreach (ScanFinding f in report.Findings)
            {
                if (f.Severity == "error") errors.Add(Path.GetFileName(f.File) + ":" + f.Line + " " + f.Code);
            }
            Assert.AreEqual(0, report.Errors, string.Join("\n", errors.ToArray()));
        }

        [Test]
        public void RoundSizeAndMixAreHonored()
        {
            ExamRoundGenerator gen = new ExamRoundGenerator(TestSupport.Data);
            RoundPlan plan = gen.BuildRound(4242, 9, Mix);
            Assert.AreEqual(9, plan.Items.Count);
            Assert.AreEqual(0, gen.BuildRound(1, 9, Mix).Shortfall);
        }

        [Test]
        public void NoQuestionRepeatsInsideARound()
        {
            RoundPlan plan = new ExamRoundGenerator(TestSupport.Data).BuildRound(4242, 9, Mix);
            HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (PlannedItem it in plan.Items) Assert.IsTrue(seen.Add(it.Chain.QId), it.Chain.QId);
        }

        [Test]
        public void PlacementsAndOcclusionsAreLegal()
        {
            ExamRoundGenerator gen = new ExamRoundGenerator(TestSupport.Data);
            for (int seed = 1; seed <= 200; seed++)
            {
                RoundPlan plan = gen.BuildRound(seed, 9, Mix);
                Assert.AreEqual(0, plan.NonDemoPlacements, "seed " + seed);
                foreach (PlannedItem it in plan.Items)
                {
                    Assert.Contains(it.Source.Id, it.Chain.Pools, it.Chain.QId);
                    if (it.OcclusionLabel.Length == 0) continue;
                    Assert.Contains(it.OcclusionLabel, it.Source.Occlusions, it.Chain.QId);
                    Assert.Contains(it.OcclusionLabel, it.Chain.Occlusions, it.Chain.QId);
                }
            }
        }

        [Test]
        public void SameSeedReproducesTheSameRound()
        {
            ExamRoundGenerator gen = new ExamRoundGenerator(TestSupport.Data);
            RoundPlan a = gen.BuildRound(777, 9, Mix);
            RoundPlan b = gen.BuildRound(777, 9, Mix);
            Assert.AreEqual(a.Items.Count, b.Items.Count);
            for (int i = 0; i < a.Items.Count; i++)
            {
                Assert.AreEqual(a.Items[i].Chain.QId, b.Items[i].Chain.QId);
                Assert.AreEqual(a.Items[i].Source.Id, b.Items[i].Source.Id);
                Assert.AreEqual(a.Items[i].OcclusionId, b.Items[i].OcclusionId);
            }
        }
    }
}
