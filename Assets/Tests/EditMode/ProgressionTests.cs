using System.Collections.Generic;
using NUnit.Framework;

namespace APlus.Tests
{
    /// <summary>Design doc 2.4 (death curve), 2.5 (repeat / hold back / year), part 3 (clock), 2.3 (director).</summary>
    public class ProgressionTests
    {
        // ---- 2.4 death curve: the five stages hold ----

        [Test]
        public void StageOneIsAFullJumpScare()
        {
            DeathPresentation p = new DeathCurve().Evaluate(1);
            Assert.AreEqual(1f, p.StingerVolume);
            Assert.AreEqual(1f, p.FlashIntensity);
            Assert.AreEqual(1f, p.CameraRush);
            Assert.AreEqual(0f, p.LeadInSilenceSeconds);
            Assert.AreEqual(0f, p.PostDeathDwellSeconds);
            Assert.IsTrue(p.FaceAppears);
            Assert.IsFalse(p.Eventless);
        }

        [Test]
        public void StageTwoRushStopsHalfwayAndSoundIsMuffled()
        {
            DeathPresentation p = new DeathCurve().Evaluate(4);
            Assert.That(p.CameraRush, Is.InRange(0.2f, 0.8f));
            Assert.Greater(p.StingerMuffle, 0f);
            Assert.Greater(p.StingerVolume, 0f);
            Assert.That(p.LeadInSilenceSeconds, Is.InRange(0.3f, 1.0f));
        }

        [Test]
        public void StageThreeStandsStillWithDelayedSound()
        {
            DeathCurve c = new DeathCurve();
            for (int n = 6; n <= 9; n++)
            {
                DeathPresentation p = c.Evaluate(n);
                Assert.AreEqual(0f, p.CameraRush, "n=" + n);
                Assert.AreEqual(0f, p.FlashIntensity, "n=" + n);
                Assert.That(p.AudioDelaySeconds, Is.InRange(0.3f, 1.5f), "n=" + n);
                Assert.IsTrue(p.FaceAppears, "n=" + n);
            }
        }

        [Test]
        public void StageFourIsSilentWithoutAFace()
        {
            DeathCurve c = new DeathCurve();
            for (int n = 10; n <= 14; n++)
            {
                DeathPresentation p = c.Evaluate(n);
                Assert.AreEqual(0f, p.StingerVolume, "n=" + n);
                Assert.IsFalse(p.FaceAppears, "n=" + n);
                Assert.IsFalse(p.Eventless, "n=" + n);
            }
        }

        [Test]
        public void StageFiveIsAnEventlessDeath()
        {
            DeathPresentation p = new DeathCurve().Evaluate(15);
            Assert.IsTrue(p.Eventless);
            Assert.AreEqual(8f, p.PostDeathDwellSeconds, 0.001f);
        }

        [Test]
        public void EveryComponentMovesMonotonically()
        {
            DeathCurve c = new DeathCurve();
            DeathPresentation prev = c.Evaluate(1);
            for (int n = 2; n <= 20; n++)
            {
                DeathPresentation p = c.Evaluate(n);
                Assert.LessOrEqual(p.StingerVolume, prev.StingerVolume, "n=" + n);
                Assert.LessOrEqual(p.FlashIntensity, prev.FlashIntensity, "n=" + n);
                Assert.LessOrEqual(p.CameraRush, prev.CameraRush, "n=" + n);
                Assert.GreaterOrEqual(p.LeadInSilenceSeconds, prev.LeadInSilenceSeconds, "n=" + n);
                Assert.GreaterOrEqual(p.AudioDelaySeconds, prev.AudioDelaySeconds, "n=" + n);
                Assert.GreaterOrEqual(p.PostDeathDwellSeconds, prev.PostDeathDwellSeconds, "n=" + n);
                prev = p;
            }
        }

        // ---- 2.5 repeat structure ----

        [Test]
        public void DeathRetriesTheSameSessionAndBumpsTheHeader()
        {
            RunState run = new RunState(1);
            Assert.AreEqual(RunTransition.Retry, run.CompleteAttempt(true, 0, DeathCause.Anomaly));
            Assert.AreEqual(2, run.Attempt);
            Assert.AreEqual(1, run.TotalDeaths);
            Assert.AreEqual(1, run.Session);
        }

        [Test]
        public void EachAttemptDrawsADifferentSeed()
        {
            RunState run = new RunState(1);
            int first = run.RoundSeed;
            run.CompleteAttempt(true, 0, DeathCause.Anomaly);
            Assert.AreNotEqual(first, run.RoundSeed);
        }

        [Test]
        public void FiveDeathsInOneSessionHoldYouBack()
        {
            RunState run = new RunState(1);
            run.SessionCount = 4;
            RunTransition last = RunTransition.Retry;
            for (int i = 0; i < 5; i++) last = run.CompleteAttempt(true, 0, DeathCause.Records);
            Assert.AreEqual(RunTransition.HeldBack, last);
            Assert.AreEqual(2, run.Session);
            Assert.AreEqual(0, run.DeathsThisSession);
            Assert.AreEqual(1, run.HeldBackCount);
        }

        [Test]
        public void TheDemoEndsAfterItsOnlySession()
        {
            RunState run = new RunState(1);
            Assert.AreEqual(RunTransition.RunComplete, run.CompleteAttempt(false, 1, DeathCause.None));
            Assert.IsTrue(run.IsComplete);
        }

        [Test]
        public void YearWalksBackOneToThreeYearsPerDeathAndStopsAt1998()
        {
            RunState run = new RunState(7);
            run.SessionCount = 100;
            int prev = run.Year;
            Assert.AreEqual(2026, prev);
            for (int i = 0; i < 40; i++)
            {
                run.CompleteAttempt(true, 0, DeathCause.Anomaly);
                int step = prev - run.Year;
                if (prev > run.EarliestYear + 3) Assert.That(step, Is.InRange(1, 3), "death " + (i + 1));
                prev = run.Year;
            }
            Assert.AreEqual(1998, run.Year);
        }

        [Test]
        public void RecordsAndDeathsAreWrittenIntoTheLedger()
        {
            RunState run = new RunState(1);
            run.CompleteAttempt(true, 2, DeathCause.Records);
            Assert.AreEqual(3, run.Ledger.Count);
            Assert.AreEqual(LedgerEntryKind.Record, run.Ledger[0].Kind);
            Assert.AreEqual(LedgerEntryKind.Death, run.Ledger[2].Kind);
            Assert.AreEqual(2026, run.Ledger[2].Year);
        }

        [Test]
        public void AdaptedNoteAndCandidateHeaderAppearLate()
        {
            RunState run = new RunState(1);
            run.SessionCount = 100;
            for (int i = 0; i < 9; i++) run.CompleteAttempt(true, 0, DeathCause.Anomaly);
            Assert.IsFalse(run.LedgerShowsAdaptedNote);
            run.CompleteAttempt(true, 0, DeathCause.Anomaly);
            Assert.IsTrue(run.LedgerShowsAdaptedNote);
            Assert.IsFalse(run.HeaderShowsCandidateNumber);
            for (int i = 0; i < 4; i++) run.CompleteAttempt(true, 0, DeathCause.Anomaly);
            Assert.IsTrue(run.HeaderShowsCandidateNumber);
        }

        // ---- part 3: clock and broadcast ----

        [Test]
        public void TwentyGameMinutesTakeTenRealMinutes()
        {
            ExamClock clock = new ExamClock();
            clock.Build(BroadcastTamper.Normal);
            List<BroadcastCue> fired = new List<BroadcastCue>();
            for (int i = 0; i < 599; i++) clock.Tick(1f, fired);
            Assert.IsFalse(clock.IsOver);
            clock.Tick(1f, fired);
            Assert.IsTrue(clock.IsOver);
            Assert.AreEqual("broadcast.collect.stop", fired[fired.Count - 1].Key);
        }

        [Test]
        public void NormalBroadcastAnnouncesFifteenTenFiveOne()
        {
            ExamClock clock = new ExamClock();
            clock.Build(BroadcastTamper.Normal);
            List<string> got = new List<string>();
            foreach (BroadcastCue c in clock.Plan)
            {
                if (c.Key == "broadcast.time.remain_fmt") got.Add(c.Arg);
                if (c.Key == "broadcast.time.remain_last5") got.Add("last5");
                if (c.Key == "broadcast.time.remain_last1") got.Add("last1");
            }
            CollectionAssert.AreEqual(new string[] { "15", "10", "last5", "last1" }, got);
        }

        [Test]
        public void RewoundBroadcastCountsUpwards()
        {
            ExamClock clock = new ExamClock();
            clock.Build(BroadcastTamper.Rewind);
            List<int> got = new List<int>();
            foreach (BroadcastCue c in clock.Plan) if (c.Key == "broadcast.time.remain_fmt") got.Add(int.Parse(c.Arg));
            Assert.AreEqual(4, got.Count);
            for (int i = 1; i < got.Count; i++) Assert.Greater(got[i], got[i - 1]);
        }

        [Test]
        public void RosterBroadcastReadsCandidateNumbersInsteadOfTime()
        {
            ExamClock clock = new ExamClock();
            clock.RosterNumbers = new string[] { "0601", "0713" };
            clock.Build(BroadcastTamper.Roster);
            int roster = 0;
            foreach (BroadcastCue c in clock.Plan)
            {
                Assert.AreNotEqual("broadcast.time.remain_fmt", c.Key);
                if (c.Key == "broadcast.roster_fmt") roster++;
            }
            Assert.AreEqual(4, roster);
        }

        [Test]
        public void ListeningWindowIsOpenOnlyInsideItsSlot()
        {
            ExamClock clock = new ExamClock();
            clock.Build(BroadcastTamper.Normal);
            clock.Tick(clock.ListeningStartGameSecond / clock.TimeScale - 1f, null);
            Assert.IsFalse(clock.InListening);
            clock.Tick(2f, null);
            Assert.IsTrue(clock.InListening);
            clock.Tick(clock.ListeningDurationGameSeconds / clock.TimeScale, null);
            Assert.IsFalse(clock.InListening);
        }

        // ---- 2.3 director ----

        [Test]
        public void DirectorInjectsOneGazeAtATimeAndTeacherGazesExpire()
        {
            GazeStateMachine m = new GazeStateMachine();
            GazeDirector d = new GazeDirector(InvigilatorProfile.Podium(), 99, 0f);
            int teacher = 0, anomaly = 0;
            GazeKind prev = GazeKind.None;
            for (int i = 0; i < 600 * 4; i++)
            {
                d.Tick(0.25f, m);
                m.Tick(0.25f);
                if (m.ActiveGaze != prev)
                {
                    if (m.ActiveGaze == GazeKind.Teacher) teacher++;
                    if (m.ActiveGaze == GazeKind.Anomaly)
                    {
                        anomaly++;
                        m.InjectGaze(GazeKind.None);
                    }
                    prev = m.ActiveGaze;
                }
            }
            Assert.That(teacher, Is.InRange(10, 30), "teacher gazes in 10 minutes");
            Assert.That(anomaly, Is.InRange(5, 14), "anomalies in 10 minutes");
            Assert.IsFalse(m.IsDead);
        }

        [Test]
        public void HigherAnomalyIntensityMeansMoreAnomalies()
        {
            Assert.Greater(CountAnomalies(1f), CountAnomalies(0f));
        }

        static int CountAnomalies(float intensity)
        {
            GazeStateMachine m = new GazeStateMachine();
            GazeDirector d = new GazeDirector(InvigilatorProfile.Podium(), 5, intensity);
            int n = 0;
            for (int i = 0; i < 1200 * 4; i++)
            {
                d.Tick(0.25f, m);
                if (m.ActiveGaze == GazeKind.Anomaly) { n++; m.InjectGaze(GazeKind.None); }
                if (m.ActiveGaze == GazeKind.Teacher) m.InjectGaze(GazeKind.None);
            }
            return n;
        }

        [Test]
        public void DirectorCuesBeforeAGazeLands()
        {
            GazeStateMachine m = new GazeStateMachine();
            GazeDirector d = new GazeDirector(InvigilatorProfile.Podium(), 3, 0f);
            bool cuedBeforeFirst = false;
            while (m.ActiveGaze == GazeKind.None)
            {
                if (d.IsCueing) cuedBeforeFirst = true;
                d.Tick(0.1f, m);
            }
            Assert.IsTrue(cuedBeforeFirst);
        }

        [Test]
        public void ListeningSlowsAnomaliesAndSilencesTheTeacher()
        {
            InvigilatorProfile p = InvigilatorProfile.Podium();
            GazeStateMachine m = new GazeStateMachine();
            GazeDirector d = new GazeDirector(p, 11, 1f);
            d.Listening = true;
            Assert.AreEqual(GazeKind.Anomaly, d.UpcomingKind);
            Assert.AreEqual(p.FirstAnomalyDelay / p.ListeningAnomalyRate, d.SecondsToNext, 0.01f);

            float t = 0f;
            while (m.ActiveGaze == GazeKind.None && t < 1000f)
            {
                d.Tick(0.1f, m);
                t += 0.1f;
            }
            Assert.AreEqual(GazeKind.Anomaly, m.ActiveGaze);
            Assert.AreEqual(p.FirstAnomalyDelay / p.ListeningAnomalyRate, t, 0.2f);
        }
    }
}
