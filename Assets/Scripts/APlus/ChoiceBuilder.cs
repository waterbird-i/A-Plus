using System;
using System.Collections.Generic;
using System.Globalization;

namespace APlus
{
    /// <summary>卷子上的一道四选一（决策 #38）。按 1/2/3/4 作答。</summary>
    public sealed class ExamQuestion
    {
        public string QId = "";
        public PlannedItem Plan;
        public AnswerValue Answer;
        public string[] Choices = new string[0];
        public int CorrectIndex = -1;
        public int Selected = -1;

        public bool IsCorrect { get { return Selected >= 0 && Selected == CorrectIndex; } }
    }

    /// <summary>
    /// 把一条答案链变成一道四选一。答案先按 answer_expr 求值，干扰项再按 distractors 生成：
    ///   字面列表   固定题的干扰项；以 = 开头的项按表达式求值
    ///   auto:±n    数字答案的偏移（像被挡住了最后一位 / 看错了一个年代）
    ///   rest       oneof 没被选中的那几个候选
    /// 与答案相同或彼此重复的干扰项会被跳过，所以列表可以多写几个备用。
    /// </summary>
    public static class ChoiceBuilder
    {
        public const int ChoiceCount = 4;

        public static ExamQuestion Build(AnswerChainRow row, AnswerContext ctx)
        {
            DeterministicRng rng = new DeterministicRng(unchecked(ctx.Seed * 16777619 ^ AnswerExpression.StableHash(row.QId)));
            List<AnswerValue> alternatives = new List<AnswerValue>();

            ExamQuestion q = new ExamQuestion();
            q.QId = row.QId;
            q.Answer = row.AnswerExpr.Length == 0
                ? AnswerValue.Of(row.Answer)
                : AnswerExpression.Evaluate(row.AnswerExpr, ctx, rng, alternatives);

            List<string> choices = new List<string>();
            choices.Add(q.Answer.Display);
            foreach (string d in Distractors(row, q.Answer, ctx, rng, alternatives))
            {
                if (choices.Count >= ChoiceCount) break;
                if (d.Length == 0 || choices.Contains(d)) continue;
                choices.Add(d);
            }
            if (q.Answer.IsNumber) FillNumeric(choices, q.Answer.Number);

            rng.Shuffle(choices);
            q.Choices = choices.ToArray();
            q.CorrectIndex = choices.IndexOf(q.Answer.Display);
            return q;
        }

        static IEnumerable<string> Distractors(AnswerChainRow row, AnswerValue answer, AnswerContext ctx, DeterministicRng rng, List<AnswerValue> alternatives)
        {
            string spec = row.Distractors ?? "";
            if (spec == "rest")
            {
                for (int i = 0; i < alternatives.Count; i++) yield return alternatives[i].Display;
                yield break;
            }
            if (spec.StartsWith("auto:", StringComparison.Ordinal))
            {
                if (!answer.IsNumber) throw new FormatException(row.QId + ": auto distractors need a numeric answer");
                string[] offsets = spec.Substring(5).Split('|');
                for (int i = 0; i < offsets.Length; i++)
                {
                    int off = int.Parse(offsets[i].Trim(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
                    int v = answer.Number + off;
                    if (Plausible(answer.Number, v)) yield return v.ToString(CultureInfo.InvariantCulture);
                }
                yield break;
            }
            string[] items = spec.Split('|');
            for (int i = 0; i < items.Length; i++)
            {
                string item = items[i];
                if (item.StartsWith("=", StringComparison.Ordinal))
                    yield return AnswerExpression.Evaluate(item.Substring(1), ctx, rng, null).Display;
                else
                    yield return item;
            }
        }

        /// <summary>题号、人数、年份都不会是负数；答案 ≥1 时干扰项也不该是 0。</summary>
        static bool Plausible(int answer, int candidate)
        {
            if (candidate < 0) return false;
            if (answer >= 1 && candidate < 1) return false;
            return true;
        }

        static void FillNumeric(List<string> choices, int answer)
        {
            for (int k = 2; choices.Count < ChoiceCount && k < 100; k++)
            {
                int[] tries = new int[] { answer + k, answer - k };
                for (int t = 0; t < tries.Length && choices.Count < ChoiceCount; t++)
                {
                    if (!Plausible(answer, tries[t])) continue;
                    string s = tries[t].ToString(CultureInfo.InvariantCulture);
                    if (!choices.Contains(s)) choices.Add(s);
                }
            }
        }
    }
}
