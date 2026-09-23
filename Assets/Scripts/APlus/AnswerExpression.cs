using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace APlus
{
    /// <summary>答案表达式的值：要么是整数，要么是一段文本。四选一只比较 Display。</summary>
    public struct AnswerValue
    {
        public bool IsNumber;
        public int Number;
        public string Text;

        public static AnswerValue Of(int n) { AnswerValue v = new AnswerValue(); v.IsNumber = true; v.Number = n; v.Text = ""; return v; }
        public static AnswerValue Of(string s) { AnswerValue v = new AnswerValue(); v.Text = s ?? ""; return v; }

        public string Display { get { return IsNumber ? Number.ToString(CultureInfo.InvariantCulture) : Text; } }
    }

    /// <summary>
    /// 动态答案求值时能读到的世界状态。同一轮里，场景把同一份上下文画出来，
    /// 卷子用它判分 —— 所以挂钟慢几分钟、红榜排第几，场景和答案永远一致。
    /// </summary>
    public sealed class AnswerContext
    {
        public int Seed;
        public int Year;
        public int Attempt;
        public int Deaths;
        public int RoundSize;
        /// <summary>q.fill.07：挂钟比广播慢几分钟（每轮随机 0–15）。</summary>
        public int ClockOffset;
        public readonly Dictionary<string, string> Strings = new Dictionary<string, string>(StringComparer.Ordinal);
        /// <summary>@key 取文本表里的「意思」。</summary>
        public Func<string, string> Text = delegate (string key) { return "[" + key + "]"; };

        public int IntVar(string name)
        {
            switch (name)
            {
                case "year": return Year;
                case "attempt": return Attempt;
                case "deaths": return Deaths;
                case "round_size": return RoundSize;
                case "clock_offset": return ClockOffset;
            }
            throw new FormatException("unknown variable: " + name);
        }

        public static AnswerContext FromRun(RunState run, int roundSize, StringTable table)
        {
            AnswerContext c = new AnswerContext();
            c.Seed = run.RoundSeed;
            c.Year = run.Year;
            c.Attempt = run.Attempt;
            c.Deaths = run.TotalDeaths;
            c.RoundSize = roundSize;
            c.ClockOffset = new DeterministicRng(unchecked(run.RoundSeed ^ 0x51ED270B)).Next(16);
            if (table != null) c.Text = table.Get;

            string header = run.HeaderShowsCandidateNumber
                ? run.CandidateNumber
                : Format(c.Text("paper.header.count_fmt"), run.Attempt.ToString(CultureInfo.InvariantCulture));
            c.Strings["header"] = header;
            c.Strings["candidate"] = run.CandidateNumber;
            c.Strings["roster_next"] = run.RosterNumber(0);
            return c;
        }

        public static string Format(string template, string arg)
        {
            return (template ?? "").Replace("{0}", arg ?? "");
        }
    }

    /// <summary>
    /// answer_chain.csv 里 answer_expr 与 distractors 中 `=` 项的求值器。语法（参数用 ; 分隔，避开 CSV 的逗号）：
    ///
    ///   expr    := unary (('+' | '-') unary)*
    ///   unary   := '-'? primary
    ///   primary := int | var | after(n) | rand(a;b) | oneof(e;e;…) | @key | @key(expr) | $name | 'text' | (expr)
    ///
    /// rand / oneof 用每题独立的确定性随机：同一轮同一题永远得到同一个值。
    /// </summary>
    public sealed class AnswerExpression
    {
        readonly string _s;
        readonly AnswerContext _ctx;
        readonly DeterministicRng _rng;
        int _i;

        /// <summary>oneof 没被选中的候选（给 distractors = rest 用）。</summary>
        public readonly List<AnswerValue> Alternatives = new List<AnswerValue>();

        AnswerExpression(string source, AnswerContext ctx, DeterministicRng rng)
        {
            _s = source ?? "";
            _ctx = ctx;
            _rng = rng;
        }

        public static AnswerValue Evaluate(string source, AnswerContext ctx, DeterministicRng rng, List<AnswerValue> alternatives)
        {
            AnswerExpression e = new AnswerExpression(source, ctx, rng);
            AnswerValue v = e.ParseExpr();
            e.SkipSpace();
            if (e._i != e._s.Length) throw e.Error("unexpected trailing input");
            if (alternatives != null) alternatives.AddRange(e.Alternatives);
            return v;
        }

        AnswerValue ParseExpr()
        {
            AnswerValue left = ParseUnary();
            while (true)
            {
                SkipSpace();
                if (_i >= _s.Length) return left;
                char op = _s[_i];
                if (op != '+' && op != '-') return left;
                _i++;
                AnswerValue right = ParseUnary();
                if (!left.IsNumber || !right.IsNumber) throw Error("arithmetic on text");
                left = AnswerValue.Of(op == '+' ? left.Number + right.Number : left.Number - right.Number);
            }
        }

        AnswerValue ParseUnary()
        {
            SkipSpace();
            if (Peek('-'))
            {
                _i++;
                AnswerValue v = ParsePrimary();
                if (!v.IsNumber) throw Error("negating text");
                return AnswerValue.Of(-v.Number);
            }
            return ParsePrimary();
        }

        AnswerValue ParsePrimary()
        {
            SkipSpace();
            if (_i >= _s.Length) throw Error("unexpected end");
            char c = _s[_i];

            if (c >= '0' && c <= '9')
            {
                int start = _i;
                while (_i < _s.Length && _s[_i] >= '0' && _s[_i] <= '9') _i++;
                return AnswerValue.Of(int.Parse(_s.Substring(start, _i - start), CultureInfo.InvariantCulture));
            }
            if (c == '(')
            {
                _i++;
                AnswerValue v = ParseExpr();
                Expect(')');
                return v;
            }
            if (c == '\'')
            {
                _i++;
                int end = _s.IndexOf('\'', _i);
                if (end < 0) throw Error("unterminated text");
                string text = _s.Substring(_i, end - _i);
                _i = end + 1;
                return AnswerValue.Of(text);
            }
            if (c == '$')
            {
                _i++;
                string name = ReadName(false);
                string value;
                if (!_ctx.Strings.TryGetValue(name, out value)) throw Error("unknown string variable " + name);
                return AnswerValue.Of(value);
            }
            if (c == '@')
            {
                _i++;
                string key = ReadName(true);
                string text = _ctx.Text(key);
                SkipSpace();
                if (Peek('('))
                {
                    _i++;
                    AnswerValue arg = ParseExpr();
                    Expect(')');
                    text = AnswerContext.Format(text, arg.Display);
                }
                return AnswerValue.Of(text);
            }

            string ident = ReadName(false);
            SkipSpace();
            if (!Peek('(')) return AnswerValue.Of(_ctx.IntVar(ident));
            _i++;
            List<AnswerValue> args = new List<AnswerValue>();
            SkipSpace();
            if (!Peek(')'))
            {
                while (true)
                {
                    args.Add(ParseExpr());
                    SkipSpace();
                    if (Peek(';')) { _i++; continue; }
                    break;
                }
            }
            Expect(')');
            return Call(ident, args);
        }

        AnswerValue Call(string name, List<AnswerValue> args)
        {
            if (name == "after")
            {
                RequireNumbers(name, args, 1);
                return AnswerValue.Of(_ctx.Attempt >= args[0].Number ? 1 : 0);
            }
            if (name == "rand")
            {
                RequireNumbers(name, args, 2);
                int lo = Math.Min(args[0].Number, args[1].Number);
                int hi = Math.Max(args[0].Number, args[1].Number);
                return AnswerValue.Of(lo + _rng.Next(hi - lo + 1));
            }
            if (name == "oneof")
            {
                if (args.Count < 2) throw Error("oneof needs at least 2 choices");
                int pick = _rng.Next(args.Count);
                for (int i = 0; i < args.Count; i++) if (i != pick) Alternatives.Add(args[i]);
                return args[pick];
            }
            throw Error("unknown function " + name);
        }

        void RequireNumbers(string name, List<AnswerValue> args, int count)
        {
            if (args.Count != count) throw Error(name + " expects " + count + " argument(s)");
            for (int i = 0; i < args.Count; i++) if (!args[i].IsNumber) throw Error(name + " expects numbers");
        }

        string ReadName(bool allowDots)
        {
            int start = _i;
            while (_i < _s.Length)
            {
                char c = _s[_i];
                bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || (allowDots && c == '.');
                if (!ok) break;
                _i++;
            }
            if (_i == start) throw Error("expected a name");
            return _s.Substring(start, _i - start);
        }

        void SkipSpace() { while (_i < _s.Length && _s[_i] == ' ') _i++; }
        bool Peek(char c) { return _i < _s.Length && _s[_i] == c; }

        void Expect(char c)
        {
            SkipSpace();
            if (!Peek(c)) throw Error("expected '" + c + "'");
            _i++;
        }

        FormatException Error(string message)
        {
            return new FormatException(message + " at " + _i + " in: " + _s);
        }

        /// <summary>FNV-1a：跨运行时稳定（string.GetHashCode 在 .NET 与 Mono 上不一致）。</summary>
        public static int StableHash(string s)
        {
            uint h = 2166136261u;
            byte[] bytes = Encoding.UTF8.GetBytes(s ?? "");
            for (int i = 0; i < bytes.Length; i++) { h ^= bytes[i]; h *= 16777619u; }
            return unchecked((int)h);
        }
    }
}
