using System;
using System.Collections.Generic;
using System.Text;

namespace APlus
{
    /// <summary>
    /// RFC4180 CSV 解析器，行为与 Assets/Localization/validate.js、Assets/Data/validate_chain.js
    /// 里的 JS 解析器保持一致：容忍 UTF-8 BOM、CRLF / LF、双引号包裹、引号内的逗号与换行。
    ///
    /// 刻意不引用 UnityEngine：这个文件在 Unity 与命令行原型（Tools/APlusProto）里是**同一份源码**。
    /// 见设计文档 5.5.5（String Table 从第一行代码起）。
    /// </summary>
    public static class Csv
    {
        public static List<string[]> Parse(string text)
        {
            if (text.Length > 0 && text[0] == '\uFEFF') text = text.Substring(1);

            List<string[]> rows = new List<string[]>();
            List<string> row = new List<string>();
            StringBuilder field = new StringBuilder();
            bool inQuotes = false;

            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];
                if (inQuotes)
                {
                    if (c == '"')
                    {
                        if (i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                        else inQuotes = false;
                    }
                    else field.Append(c);
                }
                else if (c == '"') inQuotes = true;
                else if (c == ',') { row.Add(field.ToString()); field.Length = 0; }
                else if (c == '\n') { row.Add(field.ToString()); field.Length = 0; rows.Add(row.ToArray()); row.Clear(); }
                else if (c != '\r') field.Append(c);
            }
            if (field.Length > 0 || row.Count > 0) { row.Add(field.ToString()); rows.Add(row.ToArray()); }

            List<string[]> outRows = new List<string[]>();
            for (int i = 0; i < rows.Count; i++)
            {
                string[] r = rows[i];
                if (r.Length == 1 && r[0].Trim().Length == 0) continue;
                outRows.Add(r);
            }
            return outRows;
        }

        /// <summary>读取一个 CSV 文件（BOM 由 StreamReader 自动吃掉）。</summary>
        public static List<string[]> ReadFile(string path)
        {
            return Parse(System.IO.File.ReadAllText(path, Encoding.UTF8));
        }
    }
}