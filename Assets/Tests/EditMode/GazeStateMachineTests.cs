using NUnit.Framework;

namespace APlus.Tests
{
    /// <summary>Design doc 2.1 / 2.2, closed by decisions #37 and #39.</summary>
    public class GazeStateMachineTests
    {
        // ---- 2.1 three gaze states ----

        [Test]
        public void PaperAccumulatesNoExposure()
        {
            GazeStateMachine m = new GazeStateMachine();
            for (int i = 0; i < 5; i++) m.Tick(1f);
            Assert.AreEqual(0f, m.Exposure);
        }

        [Test]
        public void LookingAroundAccumulatesExposureAndKillsPeripheralVision()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.SetState(GazeState.LookingAround);
            for (int i = 0; i < 2; i++) m.Tick(1f);
            Assert.Greater(m.Exposure, 0f);
            Assert.IsFalse(m.PeripheralReliable);
        }

        [Test]
        public void GlowingPhoneDrawsMoreAttentionThanLookingAround()
        {
            GazeStateMachine phone = new GazeStateMachine();
            phone.SetState(GazeState.Phone);
            GazeStateMachine look = new GazeStateMachine();
            look.SetState(GazeState.LookingAround);
            phone.Tick(1f);
            look.Tick(1f);
            Assert.Greater(phone.Exposure, look.Exposure);
        }

        [Test]
        public void ExposureDecaysBackOnPaper()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.SetState(GazeState.LookingAround);
            m.Tick(2f);
            m.SetState(GazeState.Paper);
            float before = m.Exposure;
            m.Tick(2f);
            Assert.Less(m.Exposure, before);
        }

        [Test]
        public void BreathingIsTheExposureVariable()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.SetState(GazeState.LookingAround);
            m.Tick(1.3f);
            Assert.AreEqual(m.Exposure, m.Breathing, 0.0001f);
        }

        // ---- 2.2 dual gaze: perception ----

        [Test]
        public void WarningsAreIndistinguishableForTheFirstTwoSeconds()
        {
            GazeStateMachine t = new GazeStateMachine();
            t.InjectGaze(GazeKind.Teacher);
            for (int i = 0; i < 3; i++) t.Tick(0.5f);
            Assert.AreEqual(GazeWarning.Unknown, t.Perceived);
            t.Tick(1f);
            Assert.AreEqual(GazeWarning.Teacher, t.Perceived);
        }

        // ---- 2.2 teacher gaze (decision #37) ----

        [Test]
        public void LookingUpUnderTeacherGazeCostsARecordNotDeath()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.InjectGaze(GazeKind.Teacher);
            m.SetState(GazeState.LookingAround);
            TickResult res = TestSupport.TickSeconds(m, 1.0f, 0.25f);
            Assert.AreEqual(TickResult.Recorded, res);
            Assert.AreEqual(1, m.TimesRecorded);
            Assert.IsFalse(m.IsDead);
        }

        [Test]
        public void OneGazeEventRecordsOnlyOnce()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.InjectGaze(GazeKind.Teacher);
            m.SetState(GazeState.LookingAround);
            TestSupport.TickSeconds(m, 2.0f, 0.25f);
            Assert.AreEqual(1, m.TimesRecorded);
        }

        [Test]
        public void StayingDownUnderTeacherGazeIsCorrect()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.InjectGaze(GazeKind.Teacher);
            TestSupport.TickSeconds(m, 2.0f, 0.25f);
            Assert.AreEqual(0, m.TimesRecorded);
            Assert.IsFalse(m.IsDead);
        }

        [Test]
        public void UsingThePhoneUnderTeacherGazeIsAViolation()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.InjectGaze(GazeKind.Teacher);
            m.SetState(GazeState.Phone);
            TickResult res = TestSupport.TickSeconds(m, 1.0f, 0.25f);
            Assert.AreEqual(TickResult.Recorded, res);
            Assert.AreEqual(1, m.TimesRecorded);
        }

        [Test]
        public void ThirdRecordKills()
        {
            GazeStateMachine m = new GazeStateMachine();
            for (int pass = 0; pass < 3; pass++)
            {
                m.InjectGaze(GazeKind.None);
                m.InjectGaze(GazeKind.Teacher);
                m.SetState(GazeState.LookingAround);
                TestSupport.TickSeconds(m, 1.0f, 0.25f);
                if (pass < 2) Assert.IsFalse(m.IsDead, "pass " + pass);
            }
            Assert.IsTrue(m.IsDead);
            Assert.AreEqual(DeathCause.Records, m.Cause);
            Assert.AreEqual(3, m.TimesRecorded);
        }

        [Test]
        public void TimedTeacherGazeLeavesOnItsOwn()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.InjectGaze(GazeKind.Teacher, 1.0f);
            TestSupport.TickSeconds(m, 1.5f, 0.25f);
            Assert.AreEqual(GazeKind.None, m.ActiveGaze);
        }

        // ---- exposure summons the teacher (decision #37) ----

        [Test]
        public void MaxedExposureSummonsTheTeacherInsteadOfKilling()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.SetState(GazeState.LookingAround);
            bool summoned = false;
            for (int i = 0; i < 20 && !summoned; i++) summoned = m.Tick(0.25f) == TickResult.Summoned;
            Assert.IsTrue(summoned);
            Assert.AreEqual(GazeKind.Teacher, m.ActiveGaze);
            Assert.IsTrue(m.ActiveGazeSummoned);
            Assert.IsFalse(m.IsDead);
        }

        [Test]
        public void GoingBackToPaperSurvivesASummonedGaze()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.SetState(GazeState.LookingAround);
            while (m.ActiveGaze == GazeKind.None) m.Tick(0.25f);
            m.SetState(GazeState.Paper);
            TestSupport.TickSeconds(m, m.SummonedGazeSeconds + 0.5f, 0.25f);
            Assert.AreEqual(0, m.TimesRecorded);
            Assert.AreEqual(GazeKind.None, m.ActiveGaze);
        }

        [Test]
        public void ExposureDoesNotSummonOverAnActiveAnomaly()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.InjectGaze(GazeKind.Anomaly);
            m.SetState(GazeState.LookingAround);
            m.SetAimingAtAnomaly(false);
            TestSupport.TickSeconds(m, 6.0f, 0.25f);
            Assert.AreEqual(GazeKind.Anomaly, m.ActiveGaze);
        }

        // ---- 2.2 anomaly gaze ----

        [Test]
        public void HidingFromAnAnomalyInThePaperKills()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.InjectGaze(GazeKind.Anomaly);
            TickResult res = TestSupport.TickSeconds(m, 1.0f, 0.25f);
            Assert.AreEqual(TickResult.Died, res);
            Assert.AreEqual(DeathCause.Anomaly, m.Cause);
        }

        [Test]
        public void UsingThePhoneUnderAnomalyGazeKills()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.InjectGaze(GazeKind.Anomaly);
            m.SetState(GazeState.Phone);
            TickResult res = TestSupport.TickSeconds(m, 1.0f, 0.25f);
            Assert.AreEqual(TickResult.Died, res);
            Assert.AreEqual(DeathCause.Anomaly, m.Cause);
        }

        [Test]
        public void StaringBackGivesFeedbackFromTheFirstTickAndRepels()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.InjectGaze(GazeKind.Anomaly);
            m.SetState(GazeState.LookingAround);
            m.SetAimingAtAnomaly(true);
            m.Tick(0.05f);
            Assert.Greater(m.AnomalyRepelProgress, 0f);
            TickResult res = TestSupport.TickSeconds(m, 3.0f, 0.05f);
            Assert.AreEqual(TickResult.Repelled, res);
            Assert.AreEqual(GazeKind.None, m.ActiveGaze);
        }

        [Test]
        public void AnomalyBehindYouIsNeutral()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.InjectGaze(GazeKind.Anomaly);
            m.SetState(GazeState.LookingAround);
            m.SetAimingAtAnomaly(false);
            TestSupport.TickSeconds(m, 3.0f, 0.25f);
            Assert.IsFalse(m.IsDead);
            Assert.AreEqual(0f, m.AnomalyRepelProgress);
        }

        [Test]
        public void ADeadMachineStaysDeadAndIgnoresInput()
        {
            GazeStateMachine m = new GazeStateMachine();
            m.InjectGaze(GazeKind.Anomaly);
            TestSupport.TickSeconds(m, 1.0f, 0.25f);
            m.SetState(GazeState.LookingAround);
            Assert.AreEqual(TickResult.Died, m.Tick(1f));
            Assert.AreEqual(GazeState.Paper, m.State);
        }
    }
}
