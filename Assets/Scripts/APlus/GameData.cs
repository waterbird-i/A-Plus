using System;
using System.Collections.Generic;
using System.IO;

namespace APlus
{
    public enum Difficulty { Easy, Medium, Hard }
    public enum Channel { Environment, Phone }

    /// <summary>sources.csv 的一行（4.2 环境答案源清单的数据化）。</summary>
    public sealed class AnswerSource
    {
        public string Id = "";
        public string Name = "";
        public string ChannelLabel = "";
        public string Location = "";
        public string RiskLabel = "";
        public string Demo = "";
        public string Notes = "";
        public int Line;
        public List<string> Occlusions = new List<string>();

        public Channel Channel;
        public int RiskWeight;
        public bool IsDemo { get { return Demo == "y"; } }
    }

    /// <summary>answer_chain.csv 的一行（4.3 的关卡数据）。</summary>
    public sealed class AnswerChainRow
    {
        public string QId = "";
        public string AnswerTypeLabel = "";
        public string Answer = "";
        /// <summary>动态题的机器可读答案（AnswerExpression 语法）；固定题为空，答案就是 Answer。</summary>
        public string AnswerExpr = "";
        /// <summary>四选一的干扰项（决策 #38）：字面列表 / auto:偏移 / rest。</summary>
        public string Distractors = "";
        public string CrossSource = "";
        public string DifficultyLabel = "";
        public string Demo = "";
        public string Notes = "";
        public int Line;
        public List<string> Pools = new List<string>();
        public List<string> Occlusions = new List<string>();

        public Difficulty Difficulty;
        public bool IsDemo { get { return Demo == "y"; } }
        public bool IsDynamic { get { return AnswerTypeLabel == "dynamic"; } }
    }

    /// <summary>occlusion_ids.csv 的一行：把 sources.csv 里的中文遮挡状态映射成代码可用的 ASCII 枚举名。</summary>
    public sealed class OcclusionDef
    {
        public string Label = "";     // 中文状态名（来自 sources.csv / answer_chain.csv）
        public string Id = "";        // ASCII 枚举名，代码与 JSON 里只用这个
        public string Kind = "";      // visual | audio
        public int ExtraSteps;        // 该遮挡额外要求的玩家动作数（原型模型）
        public bool Resolvable;       // false ⇒ 信息不可得，必须换到该题另一个落位池
        public string Note = "";
    }

    /// <summary>enum_labels.csv：中文标签 → ASCII id / 权重。让 C# 源码里可以一个中文字面量都没有。</summary>
    public sealed class EnumLabels
    {
        readonly Dictionary<string, string> _ids = new Dictionary<string, string>(StringComparer.Ordinal);
        readonly Dictionary<string, int> _weights = new Dictionary<string, int>(StringComparer.Ordinal);
        public List<string> Problems = new List<string>();

        public void Add(string domain, string label, string id, int weight)
        {
            _ids[domain + "|" + label] = id;
            _weights[domain + "|" + label] = weight;
        }

        public string Id(string domain, string label)
        {
            string v;
            if (_ids.TryGetValue(domain + "|" + label, out v)) return v;
            Problems.Add("enum_labels.csv missing " + domain + " -> label(line " + label.Length + " chars)");
            return "unknown";
        }

        public int Weight(string domain, string label)
        {
            int v;
            if (_weights.TryGetValue(domain + "|" + label, out v)) return v;
            Problems.Add("enum_labels.csv missing weight for domain " + domain);
            return 0;
        }

        public Difficulty ToDifficulty(string label)
        {
            string id = Id("difficulty", label);
            if (id == "easy") return Difficulty.Easy;
            if (id == "hard") return Difficulty.Hard;
            return Difficulty.Medium;
        }

        public Channel ToChannel(string label)
        {
            return Id("channel", label) == "phone" ? Channel.Phone : Channel.Environment;
        }
    }

    public sealed class GameData
    {
        public static readonly string[] SourceHeader = new string[]
        { "id", "name", "channel", "location", "risk", "demo", "occlusions", "notes" };

        public static readonly string[] ChainHeader = new string[]
        { "q_id", "answer_type", "answer", "answer_expr", "distractors", "pools", "cross_source", "occlusions", "difficulty", "demo", "notes" };

        public static readonly string[] OcclusionHeader = new string[]
        { "occlusion", "id", "kind", "extra_steps", "resolvable", "note" };

        public static readonly string[] EnumLabelHeader = new string[]
        { "domain", "label", "id", "weight", "note" };

        public List<AnswerSource> Sources = new List<AnswerSource>();
        public Dictionary<string, AnswerSource> SourceById = new Dictionary<string, AnswerSource>(StringComparer.Ordinal);
        public List<AnswerChainRow> Chain = new List<AnswerChainRow>();
        public Dictionary<string, OcclusionDef> OcclusionByLabel = new Dictionary<string, OcclusionDef>(StringComparer.Ordinal);
        public EnumLabels Labels = new EnumLabels();
        public List<string> Problems = new List<string>();
        public string DataDir = "";

        public static GameData Load(string dataDir)
        {
            GameData d = new GameData();
            d.DataDir = dataDir;
            d.LoadEnumLabels(Path.Combine(dataDir, "enum_labels.csv"));
            d.LoadOcclusions(Path.Combine(dataDir, "occlusion_ids.csv"));
            d.LoadSources(Path.Combine(dataDir, "sources.csv"));
            d.LoadChain(Path.Combine(dataDir, "answer_chain.csv"));
            d.CrossCheck();
            return d;
        }

        static List<string[]> ReadOrProblem(string path, string[] header, List<string> problems)
        {
            if (!File.Exists(path)) { problems.Add("missing file: " + Path.GetFileName(path)); return null; }
            List<string[]> rows = Csv.ReadFile(path);
            if (rows.Count == 0) { problems.Add(Path.GetFileName(path) + ": empty"); return null; }
            if (string.Join(",", rows[0]) != string.Join(",", header))
            {
                problems.Add(Path.GetFileName(path) + ": header mismatch");
                return null;
            }
            return rows;
        }

        void LoadEnumLabels(string path)
        {
            List<string[]> rows = ReadOrProblem(path, EnumLabelHeader, Problems);
            if (rows == null) return;
            for (int i = 1; i < rows.Count; i++)
            {
                if (rows[i].Length != EnumLabelHeader.Length) { Problems.Add("enum_labels.csv:" + (i + 1) + ": bad column count"); continue; }
                int w;
                if (!int.TryParse(rows[i][3], out w)) w = 0;
                Labels.Add(rows[i][0], rows[i][1], rows[i][2], w);
            }
        }

        void LoadOcclusions(string path)
        {
            List<string[]> rows = ReadOrProblem(path, OcclusionHeader, Problems);
            if (rows == null) return;
            for (int i = 1; i < rows.Count; i++)
            {
                if (rows[i].Length != OcclusionHeader.Length) { Problems.Add("occlusion_ids.csv:" + (i + 1) + ": bad column count"); continue; }
                OcclusionDef def = new OcclusionDef();
                def.Label = rows[i][0];
                def.Id = rows[i][1];
                def.Kind = rows[i][2];
                int steps;
                if (!int.TryParse(rows[i][3], out steps)) steps = 0;
                def.ExtraSteps = steps;
                def.Resolvable = rows[i][4] != "n";
                def.Note = rows[i][5];
                if (OcclusionByLabel.ContainsKey(def.Label)) { Problems.Add("occlusion_ids.csv: duplicate label at line " + (i + 1)); continue; }
                OcclusionByLabel.Add(def.Label, def);
            }
        }

        void LoadSources(string path)
        {
            List<string[]> rows = ReadOrProblem(path, SourceHeader, Problems);
            if (rows == null) return;
            for (int i = 1; i < rows.Count; i++)
            {
                if (rows[i].Length != SourceHeader.Length) { Problems.Add("sources.csv:" + (i + 1) + ": bad column count"); continue; }
                AnswerSource s = new AnswerSource();
                s.Id = rows[i][0];
                s.Name = rows[i][1];
                s.ChannelLabel = rows[i][2];
                s.Location = rows[i][3];
                s.RiskLabel = rows[i][4];
                s.Demo = rows[i][5];
                s.Notes = rows[i][7];
                s.Line = i + 1;
                SplitPipes(rows[i][6], s.Occlusions);
                s.Channel = Labels.ToChannel(s.ChannelLabel);
                s.RiskWeight = Labels.Weight("risk", s.RiskLabel);
                if (SourceById.ContainsKey(s.Id)) { Problems.Add("sources.csv: duplicate id " + s.Id); continue; }
                SourceById.Add(s.Id, s);
                Sources.Add(s);
            }
        }

        void LoadChain(string path)
        {
            List<string[]> rows = ReadOrProblem(path, ChainHeader, Problems);
            if (rows == null) return;
            for (int i = 1; i < rows.Count; i++)
            {
                if (rows[i].Length != ChainHeader.Length) { Problems.Add("answer_chain.csv:" + (i + 1) + ": bad column count"); continue; }
                AnswerChainRow c = new AnswerChainRow();
                c.QId = rows[i][0];
                c.AnswerTypeLabel = Labels.Id("answer_type", rows[i][1]);
                c.Answer = rows[i][2];
                c.AnswerExpr = rows[i][3];
                c.Distractors = rows[i][4];
                SplitPipes(rows[i][5], c.Pools);
                c.CrossSource = rows[i][6];
                SplitPipes(rows[i][7], c.Occlusions);
                c.DifficultyLabel = rows[i][8];
                c.Demo = rows[i][9];
                c.Notes = rows[i][10];
                c.Line = i + 1;
                c.Difficulty = Labels.ToDifficulty(c.DifficultyLabel);
                Chain.Add(c);
            }
        }

        static void SplitPipes(string raw, List<string> into)
        {
            if (raw == null || raw.Length == 0) return;
            string[] parts = raw.Split('|');
            for (int i = 0; i < parts.Length; i++)
            {
                string p = parts[i].Trim();
                if (p.Length > 0) into.Add(p);
            }
        }

        /// <summary>原型自带的参照完整性检查：JS 校验器查不到的、跨到新文件的东西在这里查。</summary>
        void CrossCheck()
        {
            for (int i = 0; i < Sources.Count; i++)
            {
                AnswerSource s = Sources[i];
                for (int j = 0; j < s.Occlusions.Count; j++)
                {
                    if (!OcclusionByLabel.ContainsKey(s.Occlusions[j]))
                        Problems.Add("sources.csv:" + s.Line + ": occlusion not in occlusion_ids.csv -> " + s.Occlusions[j]);
                }
            }
            for (int i = 0; i < Chain.Count; i++)
            {
                AnswerChainRow c = Chain[i];
                for (int j = 0; j < c.Pools.Count; j++)
                {
                    if (!SourceById.ContainsKey(c.Pools[j]))
                        Problems.Add("answer_chain.csv:" + c.Line + ": unknown pool source -> " + c.Pools[j]);
                }
                for (int j = 0; j < c.Occlusions.Count; j++)
                {
                    if (!OcclusionByLabel.ContainsKey(c.Occlusions[j]))
                        Problems.Add("answer_chain.csv:" + c.Line + ": occlusion not in occlusion_ids.csv -> " + c.Occlusions[j]);
                }
                // Demo 落位可达性（8.3 的排期口径）：demo=y 的题，落位池里至少要有一个 demo=y 的源。
                // 否则这道题在 Demo 里**没有合法落位** —— 这是原型跑数据时抓到的真实缺口。
                List<AnswerSource> poolSources = PoolSources(c);
                int demoPools = 0;
                for (int j = 0; j < poolSources.Count; j++) if (poolSources[j].IsDemo) demoPools++;
                if (c.IsDemo && c.Pools.Count > 0 && demoPools == 0)
                    Problems.Add("answer_chain.csv:" + c.Line + ": demo=y but every pool source is demo=n -> no legal placement in the demo: " + c.QId);

                // cross_source 必须是「源 id」（可带括号说明），否则代码没法解析它。
                if (c.CrossSource.Length > 0)
                {
                    string[] xs = c.CrossSource.Split('|');
                    for (int j = 0; j < xs.Length; j++)
                    {
                        string id = StripDescription(xs[j]);
                        if (id.Length > 0 && !SourceById.ContainsKey(id))
                            Problems.Add("answer_chain.csv:" + c.Line + ": cross_source is not a known source id -> " + xs[j]);
                    }
                }

                if (c.IsDynamic && c.AnswerTypeLabel != "dynamic")
                    Problems.Add("answer_chain.csv:" + c.Line + ": answer_type did not resolve");
            }
        }

        /// <summary>取「源 id」本体：允许 "eraser（借橡皮金属反光...）" 这种带说明的写法。</summary>
        static string StripDescription(string raw)
        {
            string s = raw == null ? "" : raw.Trim();
            int cut = s.IndexOf('(');
            int full = s.IndexOf((char)0xFF08);
            if (cut < 0 || (full >= 0 && full < cut)) cut = full;
            if (cut >= 0) s = s.Substring(0, cut);
            return s.Trim();
        }

        public List<AnswerSource> PoolSources(AnswerChainRow c)
        {
            List<AnswerSource> list = new List<AnswerSource>();
            for (int i = 0; i < c.Pools.Count; i++)
            {
                AnswerSource s;
                if (SourceById.TryGetValue(c.Pools[i], out s)) list.Add(s);
            }
            return list;
        }

        /// <summary>该题的落位池是否跨了两条通道（4.2：两条通道必须互相不可替代）。</summary>
        public bool IsMixedChannel(AnswerChainRow c)
        {
            bool env = false, phone = false;
            List<AnswerSource> pool = PoolSources(c);
            for (int i = 0; i < pool.Count; i++)
            {
                if (pool[i].Channel == Channel.Phone) phone = true; else env = true;
            }
            return env && phone;
        }

        public int CountByDifficulty(Difficulty d, bool demoOnly)
        {
            int n = 0;
            for (int i = 0; i < Chain.Count; i++)
            {
                if (demoOnly && !Chain[i].IsDemo) continue;
                if (Chain[i].Difficulty == d) n++;
            }
            return n;
        }
    }
}