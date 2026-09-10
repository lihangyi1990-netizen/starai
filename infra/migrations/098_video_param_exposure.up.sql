-- Expose every documented video parameter as a real UI control.
--
-- Source of truth: https://canvas.ailxp.top/ailxp-video-api.html (15 models).
-- Scope here: only the 6 video models actually enabled on tuna.
--
-- Why this is a data migration and not frontend code: VideoOptionToolbar.tsx
-- already renders whatever input_schema.properties declares, and
-- VideoUploadArea.tsx already renders reference image/video/audio slots from
-- runtime_rule.video.*.max.  The controls were missing because the synced rows
-- carried a generic 3-field schema (count/duration/orientation) copied from the
-- Sora demo model, with no resolution at all and upload_profile=single_ref.
--
-- Three traps this migration is written around:
--
-- 1. runtime_rule is MERGED, never replaced.  It also holds poll_path,
--    poll_interval_sec, poll_timeout_sec, strip_params and capabilities;
--    replacing the object wholesale would break task polling.
--    coalesce(...,'{}') is required because 满血国服 has no "video" key yet.
--
-- 2. `orientation` is dropped from schema, include and map.  It only ever
--    produced 9:16 / 16:9, which is why users could not reach 1:1, 4:3, 3:4,
--    21:9 or adaptive.  A real aspect_ratio field replaces it.
--
-- 3. upstream.static stays as-is (a fallback, not an override):
--    params.go:34-38 writes static first, then :51 lets the include loop
--    overwrite it, so a user's pick wins.  Static values are kept so an
--    unset param still yields a valid upstream body.
--
-- upload_profile is set to "minimax_h3" for the multi-material models.  The
-- name is provider-specific but the branch (VideoUploadArea.tsx:326) is
-- generic: it renders image + video + audio stacks sized from config, plus
-- first/last frame modes.  It is gated on generation_mode, so every model
-- below also gets a generation_mode control -- without one, activeMode
-- defaults to "text" and the whole upload area renders nothing.

-- ---------------------------------------------------------------- 满血国服
-- doc: duration 4-15 int | aspect_ratio 6 ratios (no adaptive) | resolution
-- 480p|720p | refs 9 img / 3 video / 3 audio.  Uses aspect_ratio, not ratio.
UPDATE models SET
  input_schema = '{
    "type":"object",
    "properties":{
      "count":{"type":"integer","title":"生成数量","enum":[1,3,5,10,30,50],"default":1,"minimum":1,"maximum":50,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true,"x-allow-custom":true},
      "generation_mode":{"type":"string","title":"素材模式","enum":["text","reference"],"enumLabels":{"text":"纯文本","reference":"参考图/视频/音频"},"default":"text","x-order":2,"x-widget":"option_menu","x-icon":"sparkles"},
      "duration":{"type":"string","title":"视频时长","enum":["4s","5s","6s","8s","10s","12s","15s"],"default":"5s","x-order":3,"x-widget":"option_menu","x-icon":"clock"},
      "aspect_ratio":{"type":"string","title":"视频比例","enum":["16:9","9:16","1:1","4:3","3:4","21:9"],"default":"9:16","x-order":4,"x-widget":"option_menu","x-icon":"ratio"},
      "resolution":{"type":"string","title":"分辨率","enum":["480p","720p"],"default":"720p","x-order":5,"x-widget":"option_menu","x-icon":"target"}
    }
  }'::jsonb,
  default_params = '{"count":1,"generation_mode":"text","duration":"5s","aspect_ratio":"9:16","resolution":"720p"}'::jsonb,
  runtime_rule = runtime_rule || jsonb_build_object(
    -- NOTE: this model's runtime_rule.video is NULL in prod, so unlike the
    -- others it needs the full block, count_*/show_* included -- coalescing to
    -- '{}' would otherwise leave it without count options or quota accounting.
    'video', coalesce(runtime_rule->'video','{}'::jsonb) || '{
      "upload_profile":"minimax_h3",
      "mode_param":"generation_mode",
      "min_reference_images":0,
      "max_reference_images":9,
      "max_total_images":9,
      "reference_images":{"key":"reference_images","max":9},
      "reference_videos":{"key":"reference_videos","max":3},
      "reference_audios":{"key":"reference_audios","max":3},
      "count_max":50,
      "count_options":[1,3,5,10,30,50],
      "count_allow_custom":true,
      "count_toward_total":true,
      "show_channel":false,
      "show_web_search":false,
      "prompt_required":true,
      "prompt_hint":"最多 9 张参考图、3 个参考视频、3 个参考音频。参考素材必须是公网可直接访问的链接。"
    }'::jsonb,
    'upstream', (runtime_rule->'upstream') - 'map' || '{
      "include":["duration","aspect_ratio","resolution","reference_images","reference_videos","reference_audios"]
    }'::jsonb
  )
WHERE code = 'seedance2.0满血国服（卡脸）';

-- ------------------------------------------------------- sd_2.5_special_v1
-- doc: duration 4-30 | aspect_ratio 6 + adaptive | resolution fixed 720p |
-- refs 30 img / 10 video / 10 audio | seed, generate_audio, tools.
-- No first_image/last_image: all images go into reference_images.
UPDATE models SET
  input_schema = '{
    "type":"object",
    "properties":{
      "count":{"type":"integer","title":"生成数量","enum":[1,3,5,10,30,50],"default":1,"minimum":1,"maximum":50,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true,"x-allow-custom":true},
      "generation_mode":{"type":"string","title":"素材模式","enum":["text","reference"],"enumLabels":{"text":"纯文本","reference":"参考图/视频/音频"},"default":"text","x-order":2,"x-widget":"option_menu","x-icon":"sparkles"},
      "duration":{"type":"string","title":"视频时长","enum":["4s","5s","6s","8s","10s","12s","15s","20s","25s","30s"],"default":"5s","x-order":3,"x-widget":"option_menu","x-icon":"clock"},
      "aspect_ratio":{"type":"string","title":"视频比例","enum":["adaptive","16:9","9:16","1:1","4:3","3:4","21:9"],"enumLabels":{"adaptive":"自适应"},"default":"9:16","x-order":4,"x-widget":"option_menu","x-icon":"ratio"},
      "resolution":{"type":"string","title":"分辨率","enum":["720p"],"default":"720p","x-order":5,"x-widget":"option_menu","x-icon":"target"},
      "generate_audio":{"type":"boolean","title":"生成声音","default":true,"x-order":6,"x-widget":"boolean_toggle","x-icon":"music"},
      "seed":{"type":"integer","title":"随机种子","default":-1,"minimum":-1,"x-order":7,"x-widget":"number_input","x-icon":"target"}
    }
  }'::jsonb,
  default_params = '{"count":1,"generation_mode":"text","duration":"5s","aspect_ratio":"9:16","resolution":"720p","generate_audio":true,"seed":-1}'::jsonb,
  runtime_rule = runtime_rule || jsonb_build_object(
    'video', coalesce(runtime_rule->'video','{}'::jsonb) || '{
      "upload_profile":"minimax_h3",
      "mode_param":"generation_mode",
      "min_reference_images":0,
      "max_reference_images":30,
      "max_total_images":30,
      "reference_images":{"key":"reference_images","max":30},
      "reference_videos":{"key":"reference_videos","max":10},
      "reference_audios":{"key":"reference_audios","max":10},
      "prompt_required":true,
      "prompt_hint":"最多 30 张参考图、10 个参考视频、10 个参考音频；首尾帧也统一放进参考图。公网链接会自动导入素材库，全部就绪后才提交生成。"
    }'::jsonb,
    'upstream', (runtime_rule->'upstream') - 'map' || '{
      "include":["duration","aspect_ratio","resolution","reference_images","reference_videos","reference_audios","seed","generate_audio"]
    }'::jsonb
  )
WHERE code = 'sd_2.5_special_v1';

-- ----------------------------------------------------- sd_2.0_mini_special
-- doc: duration 4-15 | aspect_ratio 6 + adaptive | resolution fixed 720p |
-- refs 9 img, 3 audio, NO reference video | first_image/last_image mode, which
-- must not be mixed with reference_images/reference_audios | seed,
-- generate_audio.  reference_videos.max=0 hides that slot.
UPDATE models SET
  input_schema = '{
    "type":"object",
    "properties":{
      "count":{"type":"integer","title":"生成数量","enum":[1,3,5,10,30,50],"default":1,"minimum":1,"maximum":50,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true,"x-allow-custom":true},
      "generation_mode":{"type":"string","title":"素材模式","enum":["text","reference","first_frame","first_last"],"enumLabels":{"text":"纯文本","reference":"参考图/音频","first_frame":"首帧","first_last":"首尾帧"},"default":"text","x-order":2,"x-widget":"option_menu","x-icon":"sparkles"},
      "duration":{"type":"string","title":"视频时长","enum":["4s","5s","6s","8s","10s","12s","15s"],"default":"5s","x-order":3,"x-widget":"option_menu","x-icon":"clock"},
      "aspect_ratio":{"type":"string","title":"视频比例","enum":["adaptive","16:9","9:16","1:1","4:3","3:4","21:9"],"enumLabels":{"adaptive":"自适应"},"default":"9:16","x-order":4,"x-widget":"option_menu","x-icon":"ratio"},
      "resolution":{"type":"string","title":"分辨率","enum":["720p"],"default":"720p","x-order":5,"x-widget":"option_menu","x-icon":"target"},
      "generate_audio":{"type":"boolean","title":"生成声音","default":true,"x-order":6,"x-widget":"boolean_toggle","x-icon":"music"},
      "seed":{"type":"integer","title":"随机种子","default":-1,"minimum":-1,"x-order":7,"x-widget":"number_input","x-icon":"target"}
    }
  }'::jsonb,
  default_params = '{"count":1,"generation_mode":"text","duration":"5s","aspect_ratio":"9:16","resolution":"720p","generate_audio":true,"seed":-1}'::jsonb,
  runtime_rule = runtime_rule || jsonb_build_object(
    'video', coalesce(runtime_rule->'video','{}'::jsonb) || '{
      "upload_profile":"minimax_h3",
      "mode_param":"generation_mode",
      "min_reference_images":0,
      "max_reference_images":9,
      "max_total_images":9,
      "reference_images":{"key":"reference_images","max":9},
      "reference_videos":{"key":"reference_videos","max":0},
      "reference_audios":{"key":"reference_audios","max":3},
      "frames":{"first":{"key":"first_frame","label":"首帧","max":1},"last":{"key":"last_frame","label":"尾帧","max":1}},
      "prompt_required":true,
      "prompt_hint":"不支持参考视频。最多 9 张参考图、3 个参考音频；用参考音频时至少配 1 张参考图。首尾帧模式不能和普通参考图/音频混用。"
    }'::jsonb,
    'upstream', (runtime_rule->'upstream') || '{
      "include":["duration","aspect_ratio","resolution","reference_images","reference_audios","first_frame","last_frame","seed","generate_audio"],
      "map":{"first_frame":"first_image","last_frame":"last_image"}
    }'::jsonb
  )
WHERE code = 'sd_2.0_mini_special';

-- -------------------------------------------------------- seedance2.0-720p
-- doc: /v1/video/generations | seconds (string) 4-15 | aspect_ratio |
-- image_urls 9 / video_urls 3 / audio_urls 3 | generate_audio.
-- No resolution parameter at all in this protocol.
UPDATE models SET
  input_schema = '{
    "type":"object",
    "properties":{
      "count":{"type":"integer","title":"生成数量","enum":[1,3,5,10,30,50],"default":1,"minimum":1,"maximum":50,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true,"x-allow-custom":true},
      "generation_mode":{"type":"string","title":"素材模式","enum":["text","reference"],"enumLabels":{"text":"纯文本","reference":"参考图/视频/音频"},"default":"text","x-order":2,"x-widget":"option_menu","x-icon":"sparkles"},
      "duration":{"type":"string","title":"视频时长","enum":["4s","5s","6s","8s","10s","12s","15s"],"default":"5s","x-order":3,"x-widget":"option_menu","x-icon":"clock"},
      "aspect_ratio":{"type":"string","title":"视频比例","enum":["16:9","9:16","1:1","4:3","3:4","21:9"],"default":"9:16","x-order":4,"x-widget":"option_menu","x-icon":"ratio"},
      "generate_audio":{"type":"boolean","title":"生成声音","default":true,"x-order":5,"x-widget":"boolean_toggle","x-icon":"music"}
    }
  }'::jsonb,
  default_params = '{"count":1,"generation_mode":"text","duration":"5s","aspect_ratio":"9:16","generate_audio":true}'::jsonb,
  runtime_rule = runtime_rule || jsonb_build_object(
    'video', coalesce(runtime_rule->'video','{}'::jsonb) || '{
      "upload_profile":"minimax_h3",
      "mode_param":"generation_mode",
      "min_reference_images":0,
      "max_reference_images":9,
      "max_total_images":9,
      "reference_images":{"key":"reference_images","max":9},
      "reference_videos":{"key":"reference_videos","max":3},
      "reference_audios":{"key":"reference_audios","max":3},
      "prompt_required":true,
      "prompt_hint":"最多 9 张参考图、3 个参考视频、3 个参考音频。该模型无分辨率选项，固定 720P。"
    }'::jsonb,
    -- map is restated in full (not merged) purely to drop orientation.
    -- static is left untouched: seconds is currently int 5 upstream while the
    -- doc types it as a string.  Not changed here, because static is only a
    -- fallback -- include always overwrites it -- so the int/string question
    -- lives in the worker's normalizeUpstreamValue, not in this row.
    'upstream', (runtime_rule->'upstream') || '{
      "include":["duration","aspect_ratio","reference_images","reference_videos","reference_audios","generate_audio"],
      "map":{"duration":"seconds","reference_images":"image_urls","reference_videos":"video_urls","reference_audios":"audio_urls"}
    }'::jsonb
  )
WHERE code = 'seedance2.0-720p';

-- ------------------------------------------------------------- wan3.0-15s
-- doc: duration_seconds 4-15 | resolution 480p/720p/1080p | aspect_ratio 5
-- ratios (NO 21:9) | n fixed 1 | camelCase referenceImages/Videos/Audios
-- (10 / 5 / 5).
UPDATE models SET
  input_schema = '{
    "type":"object",
    "properties":{
      "count":{"type":"integer","title":"生成数量","enum":[1,3,5,10,30,50],"default":1,"minimum":1,"maximum":50,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true,"x-allow-custom":true},
      "generation_mode":{"type":"string","title":"素材模式","enum":["text","reference"],"enumLabels":{"text":"纯文本","reference":"参考图/视频/音频"},"default":"text","x-order":2,"x-widget":"option_menu","x-icon":"sparkles"},
      "duration":{"type":"string","title":"视频时长","enum":["4s","5s","6s","8s","10s","12s","15s"],"default":"5s","x-order":3,"x-widget":"option_menu","x-icon":"clock"},
      "aspect_ratio":{"type":"string","title":"视频比例","enum":["16:9","9:16","1:1","4:3","3:4"],"default":"9:16","x-order":4,"x-widget":"option_menu","x-icon":"ratio"},
      "resolution":{"type":"string","title":"分辨率","enum":["480p","720p","1080p"],"default":"720p","x-order":5,"x-widget":"option_menu","x-icon":"target"}
    }
  }'::jsonb,
  default_params = '{"count":1,"generation_mode":"text","duration":"5s","aspect_ratio":"9:16","resolution":"720p"}'::jsonb,
  runtime_rule = runtime_rule || jsonb_build_object(
    'video', coalesce(runtime_rule->'video','{}'::jsonb) || '{
      "upload_profile":"minimax_h3",
      "mode_param":"generation_mode",
      "min_reference_images":0,
      "max_reference_images":10,
      "max_total_images":10,
      "reference_images":{"key":"reference_images","max":10},
      "reference_videos":{"key":"reference_videos","max":5},
      "reference_audios":{"key":"reference_audios","max":5},
      "prompt_required":true,
      "prompt_hint":"最多 10 张参考图、5 个参考视频、5 个参考音频。该模型不支持 21:9。"
    }'::jsonb,
    'upstream', (runtime_rule->'upstream') || '{
      "include":["duration","aspect_ratio","resolution","reference_images","reference_videos","reference_audios"],
      "map":{"duration":"duration_seconds","reference_images":"referenceImages","reference_videos":"referenceVideos","reference_audios":"referenceAudios"}
    }'::jsonb
  )
WHERE code = 'wan3.0-15s';

-- ------------------------------------------------------------- minimax_h3
-- doc: duration_seconds 4-15 | resolution 768/1080p/2K/4K | aspect_ratio 6
-- ratios | refs 9 img / 3 video / 3 audio, total <= 12; picking 2K or 4K
-- requires at least one reference material (enforced in the worker, not here).
UPDATE models SET
  input_schema = '{
    "type":"object",
    "properties":{
      "count":{"type":"integer","title":"生成数量","enum":[1,3,5,10,30,50],"default":1,"minimum":1,"maximum":50,"x-order":1,"x-widget":"option_menu","x-icon":"layers","x-highlight":true,"x-allow-custom":true},
      "generation_mode":{"type":"string","title":"素材模式","enum":["text","reference"],"enumLabels":{"text":"纯文本","reference":"参考图/视频/音频"},"default":"text","x-order":2,"x-widget":"option_menu","x-icon":"sparkles"},
      "duration":{"type":"string","title":"视频时长","enum":["4s","5s","6s","8s","10s","12s","15s"],"default":"5s","x-order":3,"x-widget":"option_menu","x-icon":"clock"},
      "aspect_ratio":{"type":"string","title":"视频比例","enum":["21:9","16:9","4:3","1:1","3:4","9:16"],"default":"9:16","x-order":4,"x-widget":"option_menu","x-icon":"ratio"},
      "resolution":{"type":"string","title":"分辨率","enum":["768","1080p","2K","4K"],"enumLabels":{"768":"768P"},"default":"768","x-order":5,"x-widget":"option_menu","x-icon":"target"}
    }
  }'::jsonb,
  default_params = '{"count":1,"generation_mode":"text","duration":"5s","aspect_ratio":"9:16","resolution":"768"}'::jsonb,
  runtime_rule = runtime_rule || jsonb_build_object(
    'video', coalesce(runtime_rule->'video','{}'::jsonb) || '{
      "upload_profile":"minimax_h3",
      "mode_param":"generation_mode",
      "min_reference_images":0,
      "max_reference_images":9,
      "max_total_images":9,
      "reference_images":{"key":"reference_images","max":9},
      "reference_videos":{"key":"reference_videos","max":3},
      "reference_audios":{"key":"reference_audios","max":3},
      "prompt_required":true,
      "prompt_hint":"最多 9 张参考图、3 个参考视频、3 个参考音频，三类合计不超过 12 个。参考视频总时长 ≤ 15 秒，单个参考音频 ≤ 15 秒。选 2K 或 4K 时至少要有 1 个参考素材。"
    }'::jsonb,
    'upstream', (runtime_rule->'upstream') || '{
      "include":["duration","aspect_ratio","resolution","reference_images","reference_videos","reference_audios"],
      "map":{"duration":"duration_seconds"}
    }'::jsonb
  )
WHERE code = 'minimax_h3';
