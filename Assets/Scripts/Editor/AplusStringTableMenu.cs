#if UNITY_EDITOR
using System.Collections.Generic;
using System.IO;
using System.Text;
using APlus;
using UnityEditor;
using UnityEngine;

namespace APlus.EditorTools
{
    /// <summary>
    /// 设计文档 5.5.5 要求的那个 Editor 按钮：
    ///   1. 列出全部 en_status=todo
    ///   2. 扫描 Assets/ 报出硬编码字符串
    ///   3. 顺手跑一遍数据表检查
    ///
    /// 菜单文字刻意写成 ASCII：本文件也在「中文字面量扫描」的范围内（Assets/Scripts），
    /// 一破例整条规则就失效了。中文说明放在注释里。
    ///
    /// 注意：本文件依赖 UnityEditor，**没有经过命令行原型的编译验证**（本机未安装 Unity）。
    /// 核心逻辑（StringTable / HardcodedStringScanner）是引擎无关的纯 C#，已被原型实测。
    /// </summary>
    public static class AplusStringTableMenu
    {
        const string LocalizationDir = "Assets/Localization";
        const string DataDir = "Assets/Data";

        [MenuItem("A+/String Table/1. List en_status=todo")]
        public static void ListTodo()
        {
            StringTable table = StringTable.LoadDirectory(LocalizationDir);
            List<string> todo = new List<string>();
            foreach (TextRow row in table.Rows)
            {
                if (row.EnStatus == "todo" || row.EnStatus == "rewritten") todo.Add(row.Key + "  (" + row.EnStatus + ")");
            }
            if (todo.Count == 0) Debug.Log("[A+] en_status: nothing pending. rows=" + table.Count); // st-ok
            else Debug.Log("[A+] en_status pending: " + todo.Count + "\n" + string.Join("\n", todo.ToArray())); // st-ok
        }

        [MenuItem("A+/String Table/2. Scan hardcoded strings")]
        public static void ScanHardcoded()
        {
            ScanReport report = HardcodedStringScanner.Scan("Assets/Scripts");
            StringBuilder sb = new StringBuilder();
            sb.Append("[A+] hardcoded string scan: files=").Append(report.FilesScanned)
              .Append(" literals=").Append(report.LiteralsScanned)
              .Append(" errors=").Append(report.Errors)
              .Append(" warnings=").Append(report.Warnings);
            for (int i = 0; i < report.Findings.Count; i++)
            {
                ScanFinding f = report.Findings[i];
                sb.Append("\n  ").Append(f.Severity).Append(' ').Append(f.Code).Append(' ')
                  .Append(f.File).Append(':').Append(f.Line);
            }
            if (report.Errors > 0) Debug.LogError(sb.ToString());
            else Debug.Log(sb.ToString());
        }

        [MenuItem("A+/String Table/3. Check data tables")]
        public static void CheckData()
        {
            StringTable table = StringTable.LoadDirectory(LocalizationDir);
            GameData data = GameData.Load(DataDir);
            int problems = table.Problems.Count + data.Problems.Count + data.Labels.Problems.Count;
            StringBuilder sb = new StringBuilder();
            sb.Append("[A+] data check: table rows=").Append(table.Count)
              .Append(" sources=").Append(data.Sources.Count)
              .Append(" chains=").Append(data.Chain.Count)
              .Append(" occlusions=").Append(data.OcclusionByLabel.Count)
              .Append(" problems=").Append(problems);
            AppendAll(sb, "string table", table.Problems);
            AppendAll(sb, "game data", data.Problems);
            AppendAll(sb, "enum labels", data.Labels.Problems);
            if (problems > 0) Debug.LogError(sb.ToString());
            else Debug.Log(sb.ToString());
        }

        static void AppendAll(StringBuilder sb, string label, List<string> items)
        {
            for (int i = 0; i < items.Count; i++) sb.Append("\n  ").Append(label).Append(": ").Append(items[i]);
        }
    }
}
#endif

