using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace APlus
{
    /// <summary>String Table 的一行（列定义见 Assets/Localization/README.md）。</summary>
    public sealed class TextRow
    {
        public string Key = "";
        public string Src = "";
        public string Register = "";
        public string En = "";
        public string EnStatus = "";
        public int MaxChars;          // 0 = 未设
        public int Lines;             // 0 = 未设
        public string FontVariant = "";
        public string Note = "";
        public string File = "";
        public int Line;
    }

    /// <summary>
    /// 设计文档 5.5.5 的 C# 侧落地：把 Assets/Localization/ 下 9 张 CSV 读成一张表。
    ///
    /// 硬规则是「一个硬编码字符串都不留」。所以这个类**只认 key**，不认中文；
    /// 调用方永远写 StringTable.Get("rule.wall.05")，而不是写那句中文。
    ///
    /// 语义文本 vs 呈现文本（5.5.5）：这张表给的是「意思」。试卷抬头 / 规则墙 / 记名册 /
    /// 点阵短信的**字本身是美术资产**——本表只提供 max_chars / lines / font_variant 三个参数。
    /// </summary>
    public sealed class StringTable
    {
        public static readonly string[] Header = new string[]
        {
            "key", "src", "register", "en", "en_status", "max_chars", "lines", "font_variant", "note"
        };

        readonly Dictionary<string, TextRow> _rows = new Dictionary<string, TextRow>(StringComparer.Ordinal);
        readonly List<string> _problems = new List<string>();
        readonly List<string> _tables = new List<string>();

        /// <summary>本表是从哪个目录读的（自检「CSV 必须带 BOM」时要用）。</summary>
        public string Dir = "";

        public List<string> Problems { get { return _problems; } }
        public List<string> Tables { get { return _tables; } }
        public int Count { get { return _rows.Count; } }
        public IEnumerable<TextRow> Rows { get { return _rows.Values; } }

        public static StringTable LoadDirectory(string directory)
        {
            StringTable table = new StringTable();
            table.Dir = directory;
            string[] files = Directory.GetFiles(directory, "*.csv");
            Array.Sort(files, StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < files.Length; i++) table.LoadFile(files[i]);
            return table;
        }

        public void LoadFile(string path)
        {
            string name = Path.GetFileName(path);
            List<string[]> rows = Csv.ReadFile(path);
            if (rows.Count == 0) { _problems.Add(name + ": empty file"); return; }

            string[] head = rows[0];
            if (string.Join(",", head) != string.Join(",", Header))
            {
                _problems.Add(name + ": header mismatch -> " + string.Join(",", head));
                return;
            }

            int dataRows = 0;
            for (int i = 1; i < rows.Count; i++)
            {
                string[] r = rows[i];
                int line = i + 1;
                if (r.Length != Header.Length)
                {
                    _problems.Add(name + ":" + line + ": column count " + r.Length + " != " + Header.Length);
                    continue;
                }

                TextRow row = new TextRow();
                row.Key = r[0];
                row.Src = r[1];
                row.Register = r[2];
                row.En = r[3];
                row.EnStatus = r[4];
                row.MaxChars = ParseInt(r[5]);
                row.Lines = ParseInt(r[6]);
                row.FontVariant = r[7];
                row.Note = r[8];
                row.File = name;
                row.Line = line;

                if (row.Key.Length == 0) { _problems.Add(name + ":" + line + ": empty key"); continue; }
                if (_rows.ContainsKey(row.Key))
                {
                    _problems.Add(name + ":" + line + ": duplicate key " + row.Key);
                    continue;
                }
                _rows.Add(row.Key, row);
                dataRows++;
            }
            _tables.Add(name + " (" + dataRows + ")");
        }

        public bool TryGet(string key, out TextRow row)
        {
            return _rows.TryGetValue(key, out row);
        }

        /// <summary>按 key 取「意思」。缺 key 时记问题并回落成 key 本身（不许崩，也不许偷偷给空串）。</summary>
        public string Get(string key)
        {
            TextRow row;
            if (!_rows.TryGetValue(key, out row))
            {
                _problems.Add("missing key: " + key);
                return "[" + key + "]";
            }
            return Resolve(row);
        }

        /// <summary>
        /// 5.5.5：缺值时回落显示 src 并在日志报警。
        /// B（界面英文）永不做（决策 #28）⇒ en 列永远为空 ⇒ 这里永远走 src。
        /// </summary>
        public string Resolve(TextRow row)
        {
            if (row.En.Length > 0) return row.En;
            if (row.EnStatus.Length > 0 && row.EnStatus != "n/a")
            {
                _problems.Add("en_status=" + row.EnStatus + " but en is empty; fell back to src: " + row.Key);
            }
            return row.Src;
        }

        /// <summary>所有以某个前缀开头的行（例：GetByPrefix("q.") 取整个题库）。</summary>
        public List<TextRow> GetByPrefix(string prefix)
        {
            List<TextRow> hits = new List<TextRow>();
            foreach (KeyValuePair<string, TextRow> kv in _rows)
            {
                if (kv.Key.StartsWith(prefix, StringComparison.Ordinal)) hits.Add(kv.Value);
            }
            hits.Sort(delegate (TextRow a, TextRow b) { return string.CompareOrdinal(a.Key, b.Key); });
            return hits;
        }

        static int ParseInt(string s)
        {
            int v;
            if (int.TryParse(s, out v)) return v;
            return 0;
        }
    }
}