using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace APlus
{
    public sealed class ScanFinding
    {
        public string File = "";
        public int Line;
        public string Severity = "error";   // error | warning
        public string Code = "";            // cjk-literal | cjk-escape | cjk-char | log-literal
        public string Detail = "";
    }

    public sealed class ScanReport
    {
        public List<ScanFinding> Findings = new List<ScanFinding>();
        public int FilesScanned;
        public int LiteralsScanned;

        public int Errors { get { return Count("error"); } }
        public int Warnings { get { return Count("warning"); } }

        int Count(string severity)
        {
            int n = 0;
            for (int i = 0; i < Findings.Count; i++) if (Findings[i].Severity == severity) n++;
            return n;
        }
    }

    /// <summary>
    /// 设计文档 5.5.5 / 8.3-6 要求的「扫描 Assets/ 报出硬编码字符串」。
    ///
    /// 规则（两条，不做模糊的启发式）：
    ///   1. error · 中文字面量：源码里的字符串/字符字面量一旦含 CJK 码点就是错误。
    ///      \uXXXX 转义会被**解出来再判**，所以「用转义绕过扫描」这条路是堵死的。
    ///      这条规则够用的前提是：这个游戏的全部用户可见文本都是中文。
    ///   2. warning · 日志字面量：Debug.Log / LogWarning / LogError / print 直接吃字面量。
    ///      5.5.5 建议这类也走表（便于在英文环境里测试）。
    ///
    /// 已知局限（写清楚，不假装万能）：**纯 ASCII 的用户可见文案不会被抓**。
    /// 那类文本要靠 code review，或者以后加一条更严的规则。
    ///
    /// 抑制方式：该行任意位置写 st-ok 注释（用于确实必须存在的字面量，例如开发工具的日志前缀）。
    /// </summary>
    public static class HardcodedStringScanner
    {
        public static ScanReport Scan(params string[] roots)
        {
            ScanReport report = new ScanReport();
            for (int i = 0; i < roots.Length; i++)
            {
                if (Directory.Exists(roots[i])) ScanDirectory(roots[i], report);
                else if (File.Exists(roots[i])) ScanFile(roots[i], report);
            }
            return report;
        }

        public static void ScanDirectory(string root, ScanReport report)
        {
            string[] files = Directory.GetFiles(root, "*.cs", SearchOption.AllDirectories);
            Array.Sort(files, StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < files.Length; i++) ScanFile(files[i], report);
        }

        static bool IsCjk(char c)
        {
            int v = (int)c;
            if (v >= 0x3000 && v <= 0x303F) return true;   // CJK 标点（含全角空格）
            if (v >= 0x3400 && v <= 0x4DBF) return true;   // 扩展 A
            if (v >= 0x4E00 && v <= 0x9FFF) return true;   // 基本区
            if (v >= 0xF900 && v <= 0xFAFF) return true;   // 兼容表意
            if (v >= 0xFF01 && v <= 0xFF60) return true;   // 全角形式
            if (v >= 0xFFE0 && v <= 0xFFE6) return true;   // 全角符号
            return false;
        }

        public static void ScanFile(string path, ScanReport report)
        {
            string text;
            try { text = File.ReadAllText(path, Encoding.UTF8); }
            catch (Exception) { return; }
            report.FilesScanned++;

            string[] lines = text.Replace("\r\n", "\n").Split('\n');
            bool inBlockComment = false;

            for (int li = 0; li < lines.Length; li++)
            {
                string line = lines[li];
                if (line.IndexOf("st-ok", StringComparison.Ordinal) >= 0) continue;

                int i = 0;
                while (i < line.Length)
                {
                    if (inBlockComment)
                    {
                        int end = line.IndexOf("*/", i, StringComparison.Ordinal);
                        if (end < 0) { i = line.Length; break; }
                        inBlockComment = false; i = end + 2; continue;
                    }
                    char c = line[i];
                    if (c == '/' && i + 1 < line.Length && line[i + 1] == '/') break;               // 行注释
                    if (c == '/' && i + 1 < line.Length && line[i + 1] == '*') { inBlockComment = true; i += 2; continue; }
                    if (c == '\'') { i = ScanCharLiteral(line, i, path, li, report); continue; }     // 字符字面量
                    if (c == '@' && i + 1 < line.Length && line[i + 1] == '"') { i = ScanString(line, i + 1, true, path, li, report); continue; }
                    if (c == '"') { i = ScanString(line, i, false, path, li, report); continue; }
                    i++;
                }
            }
        }

        /// <summary>返回下一个待处理的下标。</summary>
        static int ScanCharLiteral(string line, int start, string path, int lineIndex, ScanReport report)
        {
            int i = start + 1;
            string raw = "";
            while (i < line.Length)
            {
                char c = line[i];
                if (c == '\\' && i + 1 < line.Length) { raw += c; raw += line[i + 1]; i += 2; continue; }
                if (c == '\'') { i++; break; }
                raw += c; i++;
            }
            report.LiteralsScanned++;
            string resolved = ResolveEscapes(raw);
            if (FirstCjk(resolved) >= 0)
            {
                bool viaEscape = raw.IndexOf("\\u", StringComparison.Ordinal) >= 0;
                Add(report, path, lineIndex + 1, "error", viaEscape ? "cjk-escape" : "cjk-char", raw);
            }
            return i;
        }

        /// <summary>返回下一个待处理的下标。</summary>
        static int ScanString(string line, int quoteIndex, bool verbatim, string path, int lineIndex, ScanReport report)
        {
            int i = quoteIndex + 1;
            string raw = "";
            while (i < line.Length)
            {
                char c = line[i];
                if (!verbatim && c == '\\' && i + 1 < line.Length) { raw += c; raw += line[i + 1]; i += 2; continue; }
                if (verbatim && c == '"' && i + 1 < line.Length && line[i + 1] == '"') { raw += "\"\""; i += 2; continue; }
                if (c == '"') { i++; break; }
                raw += c; i++;
            }
            report.LiteralsScanned++;
            string resolved = ResolveEscapes(raw);
            if (FirstCjk(resolved) >= 0)
            {
                bool viaEscape = raw.IndexOf("\\u", StringComparison.Ordinal) >= 0;
                string code = (viaEscape && FirstCjk(StripEscapes(raw)) < 0) ? "cjk-escape" : "cjk-literal";
                Add(report, path, lineIndex + 1, "error", code, raw);
            }

            string before = line.Substring(0, Math.Max(0, quoteIndex));
            if (!IsKnownApiName(raw) && LooksLikeLogCall(before)) Add(report, path, lineIndex + 1, "warning", "log-literal", raw);

            return i;
        }

        static bool LooksLikeLogCall(string before)
        {
            string[] needles = new string[] { "Debug.Log", "LogWarning", "LogError", "print(", "Console.Write" };
            int best = -1;
            for (int i = 0; i < needles.Length; i++)
            {
                int idx = before.LastIndexOf(needles[i], StringComparison.Ordinal);
                if (idx >= 0 && idx + needles[i].Length > best) best = idx + needles[i].Length;
            }
            if (best < 0) return false;
            // 只认「这个字面量被日志函数直接吃掉」：needle 与本字面量之间只允许
            // 空白、括号、逗号、加号，以及已经闭合的字符串字面量。
            bool inString = false;
            for (int i = best; i < before.Length; i++)
            {
                char c = before[i];
                if (c == '"') { inString = !inString; continue; }
                if (inString) continue;
                if (c == ' ' || c == '\t' || c == '(' || c == ',' || c == '+') continue;
                return false;
            }
            return !inString;
        }

        /// <summary>字面量本身就是日志 API 名（例如扫描器自己的模式表）——不是用户可见文案，跳过。</summary>
        static bool IsKnownApiName(string raw)
        {
            string[] names = new string[]
            {
                "Debug.Log", "Debug.LogWarning", "Debug.LogError",
                "LogWarning", "LogError", "print(", "Console.Write", "Console.WriteLine"
            };
            for (int i = 0; i < names.Length; i++) if (raw == names[i]) return true;
            return false;
        }

        static void Add(ScanReport report, string path, int line, string severity, string code, string detail)
        {
            ScanFinding f = new ScanFinding();
            f.File = path;
            f.Line = line;
            f.Severity = severity;
            f.Code = code;
            string d = detail;
            if (d.Length > 60) d = d.Substring(0, 57) + "...";
            f.Detail = d;
            report.Findings.Add(f);
        }

        /// <summary>把 \uXXXX / \xXX / \n 等转义解成真实字符（判 CJK 时要用解出来的结果）。</summary>
        public static string ResolveEscapes(string raw)
        {
            StringBuilder sb = new StringBuilder(raw.Length);
            for (int i = 0; i < raw.Length; i++)
            {
                char c = raw[i];
                if (c != '\\' || i + 1 >= raw.Length) { sb.Append(c); continue; }
                char n = raw[i + 1];
                if (n == 'u' && i + 5 < raw.Length)
                {
                    int code;
                    if (int.TryParse(raw.Substring(i + 2, 4), System.Globalization.NumberStyles.HexNumber, null, out code))
                    {
                        sb.Append((char)code); i += 5; continue;
                    }
                }
                if (n == 'x' && i + 3 < raw.Length)
                {
                    int code;
                    if (int.TryParse(raw.Substring(i + 2, 2), System.Globalization.NumberStyles.HexNumber, null, out code))
                    {
                        sb.Append((char)code); i += 3; continue;
                    }
                }
                if (n == 'n') { sb.Append('\n'); i++; continue; }
                if (n == 't') { sb.Append('\t'); i++; continue; }
                if (n == 'r') { sb.Append('\r'); i++; continue; }
                if (n == '0') { sb.Append('\0'); i++; continue; }
                sb.Append(n); i++;
            }
            return sb.ToString();
        }

        static string StripEscapes(string raw)
        {
            StringBuilder sb = new StringBuilder(raw.Length);
            for (int i = 0; i < raw.Length; i++)
            {
                if (raw[i] == '\\' && i + 1 < raw.Length) { i++; continue; }
                sb.Append(raw[i]);
            }
            return sb.ToString();
        }

        static int FirstCjk(string s)
        {
            for (int i = 0; i < s.Length; i++) if (IsCjk(s[i])) return i;
            return -1;
        }
    }
}