using System.Collections.Generic;
using System.Globalization;
using NUnit.Framework;

namespace APlus.Tests
{
    /// <summary>Decision #38 (four-choice answers) and the whole-exam loop.</summary>
    public class SessionTests
    {
        static AnswerContext ContextFor(int attempt, int deaths)
        {
            RunState run = new RunState(11);
            run.SessionCount = 100;
            for (int i = 0; i < deaths; i++) run.CompleteAttempt(true, 0, DeathCause.Anomaly);
            while (run.Attempt < attempt) run.CompleteAttempt(false, 0, DeathCause.None);
            return AnswerContext.FromRun(run, 9, TestSupport.Table);
        }

        // ---- four-choice ----

        [Test]
        public void EveryQuestionBuildsFourDistinctChoicesAcrossThirtyRounds()
        {
            List<string> failures = new List<string>();
            for (int attempt = 1; attempt <= 30; attempt++)
            {
                AnswerContext ctx = ContextFor(attempt, attempt - 1);
                foreach (AnswerChainRow row in TestSupport.Data.Chain)
                {
                    ExamQuestion q;
                    try { q = ChoiceBuilder.Build(row, ctx); }
                    catch (System.FormatException e) { failures.Add(row.QId + ": " + e.Message); continue; }
                    HashSet<string> distinct = new HashSet<string>(q.Choices);
                    if (q.Choices.Length != 4 || distinct.Count != 4) failures.Add(row.QId + " attempt " + attempt + ": " + string.Join(" / ", q.Choices));
                    else if (q.CorrectIndex < 0 || q.Choices[q.CorrectIndex] != q.Answer.Display) failures.Add(row.QId + ": correct index");
                    foreach (string c in q.Choices) if (c.StartsWith("[")) failures.Add(row.QId + ": unresolved text key " + c);
                }
            }
            Assert.IsEmpty(failures, string.Join("\n", failures.ToArray()));
        }

        [Test]
        public void FixedAnswersAreTheLiteralAnswer()
        {
            AnswerContext ctx = ContextFor(1, 0);
            foreach (AnswerChainRow row in TestSupport.Data.Chain)
            {
                if (row.AnswerExpr.Length > 0) continue;
                Assert.AreEqual(row.Answer, ChoiceBuilder.Build(row, ctx).Answer.Display, row.QId);
            }
        }

        [Test]
        public void YearQuestionsFollowTheRecedingYear()
        {
            AnswerChainRow thisYear = Find("q.news.01");
            AnswerChainRow founded = Find("q.fill.01");
            AnswerContext early = ContextFor(1, 0);
            AnswerContext late = ContextFor(8, 7);
            Assert.AreEqual(2026, ChoiceBuilder.Build(thisYear, early).Answer.Number);
            Assert.AreEqual(late.Year, ChoiceBuilder.Build(thisYear, late).Answer.Number);
            Assert.Less(late.Year, 2026);
            Assert.AreEqual(late.Year - 45, ChoiceBuilder.Build(founded, late).Answer.Number);
        }

        [Test]
        public void HeaderQuestionSwitchesToTheCandidateNumberLate()
        {
            AnswerChainRow header = Find("q.fill.43");
            string expected = AnswerContext.Format(TestSupport.Table.Get("paper.header.count_fmt"), "3");
            Assert.AreEqual(expected, ChoiceBuilder.Build(header, ContextFor(3, 0)).Answer.Display);
            Assert.AreEqual("0713", ChoiceBuilder.Build(header, ContextFor(15, 14)).Answer.Display);
        }

        [Test]
        public void ListeningQuestionDrawsFromItsFourOptions()
        {
            AnswerChainRow row = Find("q.en.03");
            HashSet<string> pool = new HashSet<string>();
            foreach (string k in new string[] { "a", "b", "c", "d" }) pool.Add(TestSupport.Table.Get("world.listening.q3.opt." + k));
            HashSet<string> answers = new HashSet<string>();
            for (int attempt = 1; attempt <= 12; attempt++)
            {
                ExamQuestion q = ChoiceBuilder.Build(row, ContextFor(attempt, 0));
                CollectionAssert.AreEquivalent(pool, q.Choices);
                answers.Add(q.Answer.Display);
            }
            Assert.Greater(answers.Count, 1, "the listening answer changes between rounds");
        }

        [Test]
        public void SameContextBuildsTheSameQuestion()
        {
            AnswerChainRow row = Find("q.fill.17");
            ExamQuestion a = ChoiceBuilder.Build(row, ContextFor(4, 3));
            ExamQuestion b = ChoiceBuilder.Build(row, ContextFor(4, 3));
            CollectionAssert.AreEqual(a.Choices, b.Choices);
            Assert.AreEqual(a.CorrectIndex, b.CorrectIndex);
        }

        [Test]
        public void ExpressionGrammar()
        {
            AnswerContext ctx = new AnswerContext();
            ctx.Year = 2020;
            ctx.Attempt = 5;
            ctx.Strings["who"] = "x";
            ctx.Text = delegate (string key) { return key == "k.fmt" ? "<{0}>" : "?"; };
            DeterministicRng rng = new DeterministicRng(1);
            Assert.AreEqual(1975, AnswerExpression.Evaluate("year-45", ctx, rng, null).Number);
            Assert.AreEqual(22, AnswerExpression.Evaluate("21+after(4)", ctx, rng, null).Number);
            Assert.AreEqual(21, AnswerExpression.Evaluate("21+after(6)", ctx, rng, null).Number);
            Assert.AreEqual("<6>", AnswerExpression.Evaluate("@k.fmt(attempt+1)", ctx, rng, null).Text);
            Assert.AreEqual("x", AnswerExpression.Evaluate("$who", ctx, rng, null).Text);
            Assert.That(AnswerExpression.Evaluate("rand(1;3)", ctx, rng, null).Number, Is.InRange(1, 3));
            List<AnswerValue> rest = new List<AnswerValue>();
            AnswerExpression.Evaluate("oneof('a';'b';'c')", ctx, rng, rest);
            Assert.AreEqual(2, rest.Count);
            Assert.Throws<System.FormatException>(delegate { AnswerExpression.Evaluate("nope", ctx, rng, null); });
            Assert.Throws<System.FormatException>(delegate { AnswerExpression.Evaluate("$who+1", ctx, rng, null); });
        }

        // ---- whole exam ----

        static ExamSession NewSession(RunState run)
        {
            ExamSession s = new ExamSession(TestSupport.Data, TestSupport.Table, run, InvigilatorProfile.Podium(), new SessionConfig(), new DeathCurve());
            s.Begin();
            return s;
        }

        /// <summary>Knows the truth and always answers it correctly: down for the teacher, stare at anomalies.</summary>
        static int PlayPerfectly(ExamSession s, SessionEvents ev)
        {
            int recordsOutsideListening = 0;
            for (int step = 0; step < 20000 && s.Phase == SessionPhase.Running; step++)
            {
                bool anomaly = s.Gaze.ActiveGaze == GazeKind.Anomaly;
                s.SetGaze(anomaly ? GazeState.LookingAround : GazeState.Paper);
                s.Gaze.SetAimingAtAnomaly(anomaly);
                if (!anomaly) for (int i = 0; i < s.Questions.Count; i++) s.Select(i, s.Questions[i].CorrectIndex);
                bool listening = s.Clock.InListening;
                ev.Clear();
                s.Tick(0.1f, ev);
                if (!listening && ev.Gaze.Contains(TickResult.Recorded)) recordsOutsideListening++;
            }
            return recordsOutsideListening;
        }

        [Test]
        public void APerfectPlayerSurvivesTheWholeExamAndScoresFull()
        {
            RunState run = new RunState(3);
            ExamSession s = NewSession(run);
            Assert.AreEqual(9, s.Questions.Count);
            int outside = PlayPerfectly(s, new SessionEvents());
            Assert.AreEqual(SessionPhase.Submitted, s.Phase);
            Assert.AreEqual(9, s.Score);
            // A2: an anomaly during listening forces a choice between a record (stare) and death (hide).
            Assert.AreEqual(0, outside);
            Assert.LessOrEqual(s.Gaze.TimesRecorded, 1);
            Assert.AreEqual(RunTransition.RunComplete, s.Finish());
        }

        [Test]
        public void ThePhaseAnnouncesEveryBroadcastInOrder()
        {
            ExamSession s = NewSession(new RunState(3));
            SessionEvents ev = new SessionEvents();
            List<string> keys = new List<string>();
            for (int step = 0; step < 20000 && s.Phase == SessionPhase.Running; step++)
            {
                bool anomaly = s.Gaze.ActiveGaze == GazeKind.Anomaly;
                s.SetGaze(anomaly ? GazeState.LookingAround : GazeState.Paper);
                s.Gaze.SetAimingAtAnomaly(anomaly);
                ev.Clear();
                s.Tick(0.1f, ev);
                foreach (BroadcastCue c in ev.Broadcasts) keys.Add(c.Key);
            }
            Assert.AreEqual(s.Clock.Plan.Count, keys.Count);
            Assert.AreEqual("broadcast.check.device", keys[0]);
            Assert.AreEqual("broadcast.collect.stop", keys[keys.Count - 1]);
        }

        [Test]
        public void AlwaysHidingInThePaperEventuallyDiesToAnAnomaly()
        {
            RunState run = new RunState(3);
            ExamSession s = NewSession(run);
            SessionEvents ev = new SessionEvents();
            for (int step = 0; step < 20000 && s.Phase == SessionPhase.Running; step++) { ev.Clear(); s.Tick(0.1f, ev); }
            Assert.AreEqual(SessionPhase.Died, s.Phase);
            Assert.AreEqual(DeathCause.Anomaly, s.Gaze.Cause);
            Assert.AreEqual(1, s.Death.DeathOrdinal);
            Assert.AreEqual(RunTransition.Retry, s.Finish());
            Assert.AreEqual(2, run.Attempt);
        }

        [Test]
        public void AnsweringIsOnlyPossibleOnThePaper()
        {
            ExamSession s = NewSession(new RunState(3));
            s.SetGaze(GazeState.LookingAround);
            Assert.IsFalse(s.Select(0, 0));
            s.SetGaze(GazeState.Paper);
            Assert.IsTrue(s.Select(0, 0));
        }

        [Test]
        public void LeavingThePaperDuringListeningIsRecorded()
        {
            ExamSession s = NewSession(new RunState(3));
            SessionEvents ev = new SessionEvents();
            float toListening = s.Clock.ListeningStartGameSecond / s.Clock.TimeScale;
            for (float t = 0f; t < toListening + 0.5f && s.Phase == SessionPhase.Running; t += 0.1f)
            {
                bool anomaly = s.Gaze.ActiveGaze == GazeKind.Anomaly;
                s.SetGaze(anomaly ? GazeState.LookingAround : GazeState.Paper);
                s.Gaze.SetAimingAtAnomaly(anomaly);
                ev.Clear();
                s.Tick(0.1f, ev);
            }
            Assert.IsTrue(s.Clock.InListening);
            int before = s.Gaze.TimesRecorded;
            s.Gaze.InjectGaze(GazeKind.None);
            s.SetGaze(GazeState.Phone);
            for (int i = 0; i < 10; i++) { ev.Clear(); s.Tick(0.1f, ev); }
            Assert.AreEqual(before + 1, s.Gaze.TimesRecorded);
        }

        [Test]
        public void LaterAttemptsCorruptTheBroadcast()
        {
            RunState run = new RunState(3);
            run.SessionCount = 100;
            Assert.AreEqual(BroadcastTamper.Normal, NewSession(run).Tamper);
            while (run.Attempt < 12) run.CompleteAttempt(true, 0, DeathCause.Anomaly);
            Assert.AreEqual(BroadcastTamper.Roster, NewSession(run).Tamper);
        }

        static AnswerChainRow Find(string qid)
        {
            foreach (AnswerChainRow r in TestSupport.Data.Chain) if (r.QId == qid) return r;
            Assert.Fail("missing " + qid);
            return null;
        }
    }
}
