-- Revert 098: restore the pre-migration schema/params/runtime_rule verbatim.
--
-- Values below are transcribed from the live prod rows before 098 ran, not
-- reconstructed, so this is a true rollback.  Note the asymmetry: the two
-- seedance rows had a completely empty input_schema (no controls at all) and
-- 满血国服 had no runtime_rule.video key whatsoever, which is why its branch
-- deletes the key instead of writing one.

-- Shared pre-098 video block for the five models that had one.
-- (upload_profile single_ref + max_reference_images 1 is the state that made
-- reference video/audio slots unreachable.)

-- ---------------------------------------------------------------- 满血国服
UPDATE models SET
  input_schema = '{"type":"object","properties":{}}'::jsonb,
  default_params = '{}'::jsonb,
  runtime_rule = (runtime_rule - 'video') || jsonb_build_object(
    'upstream', '{
      "map":{"orientation":"aspect_ratio"},
      "static":{"duration":5,"resolution":"720p","aspect_ratio":"9:16","_preserve_video_params":true},
      "include":["duration","orientation","aspect_ratio","resolution","reference_images","reference_videos","reference_audios"],
      "poll_path":"/v1/videos/{id}",
      "strip_params":["category_source","user_prompt"],
      "poll_timeout_sec":1800,
      "poll_interval_sec":5,
      "request_timeout_sec":120
    }'::jsonb
  )
WHERE code = 'seedance2.0满血国服（卡脸）';

-- ------------------------------------------------------- sd_2.5_special_v1
UPDATE models SET
  input_schema = '{"type":"object","properties":{"count":{"enum":[1,3,5,10,30,50],"type":"integer","title":"生成数量","x-icon":"layers","default":1,"maximum":50,"minimum":1,"x-order":1,"x-widget":"option_menu","x-highlight":true,"x-allow-custom":true},"duration":{"enum":["4s","8s","12s"],"type":"string","title":"视频时长","x-icon":"clock","default":"4s","x-order":2,"x-widget":"option_menu"},"orientation":{"enum":["portrait","landscape"],"type":"string","title":"画面方向","x-icon":"ratio","default":"portrait","x-order":3,"x-widget":"option_menu","enumLabels":{"portrait":"竖屏","landscape":"横屏"}}}}'::jsonb,
  default_params = '{"count":1,"duration":"4s","orientation":"portrait"}'::jsonb,
  runtime_rule = runtime_rule || jsonb_build_object(
    'video', '{"frames":{"last":{"key":"last_frame","max":1,"label":"尾帧"},"first":{"key":"first_frame","max":1,"label":"首帧"}},"count_max":50,"mode_param":"generation_mode","prompt_hint":"","show_channel":false,"count_options":[1,3,5,10,30,50],"upload_profile":"single_ref","prompt_required":true,"show_web_search":false,"max_total_images":9,"reference_audios":{"key":"reference_audios","max":3},"reference_images":{"key":"reference_images","max":4},"reference_videos":{"key":"reference_videos","max":3},"count_allow_custom":true,"count_toward_total":true,"max_reference_images":1,"min_reference_images":0}'::jsonb,
    'upstream', '{
      "map":{"orientation":"aspect_ratio"},
      "static":{"duration":4,"resolution":"720p","aspect_ratio":"9:16","_preserve_video_params":true},
      "include":["duration","orientation","aspect_ratio","reference_images","reference_videos","reference_audios","seed","generate_audio"],
      "poll_path":"/v1/videos/{id}",
      "strip_params":["category_source","user_prompt"],
      "poll_timeout_sec":1800,
      "poll_interval_sec":5,
      "request_timeout_sec":120
    }'::jsonb
  )
WHERE code = 'sd_2.5_special_v1';

-- ----------------------------------------------------- sd_2.0_mini_special
UPDATE models SET
  input_schema = '{"type":"object","properties":{"count":{"enum":[1,3,5,10,30,50],"type":"integer","title":"生成数量","x-icon":"layers","default":1,"maximum":50,"minimum":1,"x-order":1,"x-widget":"option_menu","x-highlight":true,"x-allow-custom":true},"duration":{"enum":["4s","8s","12s"],"type":"string","title":"视频时长","x-icon":"clock","default":"4s","x-order":2,"x-widget":"option_menu"},"orientation":{"enum":["portrait","landscape"],"type":"string","title":"画面方向","x-icon":"ratio","default":"portrait","x-order":3,"x-widget":"option_menu","enumLabels":{"portrait":"竖屏","landscape":"横屏"}}}}'::jsonb,
  default_params = '{"count":1,"duration":"4s","orientation":"portrait"}'::jsonb,
  runtime_rule = runtime_rule || jsonb_build_object(
    'video', '{"frames":{"last":{"key":"last_frame","max":1,"label":"尾帧"},"first":{"key":"first_frame","max":1,"label":"首帧"}},"count_max":50,"mode_param":"generation_mode","prompt_hint":"","show_channel":false,"count_options":[1,3,5,10,30,50],"upload_profile":"single_ref","prompt_required":true,"show_web_search":false,"max_total_images":9,"reference_audios":{"key":"reference_audios","max":3},"reference_images":{"key":"reference_images","max":4},"reference_videos":{"key":"reference_videos","max":3},"count_allow_custom":true,"count_toward_total":true,"max_reference_images":1,"min_reference_images":0}'::jsonb,
    'upstream', '{
      "map":{"last_frame":"last_image","first_frame":"first_image","orientation":"aspect_ratio"},
      "static":{"duration":4,"resolution":"720p","aspect_ratio":"9:16","_preserve_video_params":true},
      "include":["duration","orientation","aspect_ratio","reference_images","reference_audios","first_frame","last_frame","seed","generate_audio"],
      "poll_path":"/v1/videos/{id}",
      "strip_params":["category_source","user_prompt"],
      "poll_timeout_sec":1800,
      "poll_interval_sec":5,
      "request_timeout_sec":120
    }'::jsonb
  )
WHERE code = 'sd_2.0_mini_special';

-- -------------------------------------------------------- seedance2.0-720p
UPDATE models SET
  input_schema = '{"type":"object","properties":{}}'::jsonb,
  default_params = '{}'::jsonb,
  runtime_rule = runtime_rule || jsonb_build_object(
    'video', '{"frames":{"last":{"key":"last_frame","max":1,"label":"尾帧"},"first":{"key":"first_frame","max":1,"label":"首帧"}},"count_max":50,"mode_param":"generation_mode","prompt_hint":"","show_channel":false,"count_options":[1,3,5,10,30,50],"upload_profile":"single_ref","prompt_required":true,"show_web_search":false,"max_total_images":9,"reference_audios":{"key":"reference_audios","max":3},"reference_images":{"key":"reference_images","max":4},"reference_videos":{"key":"reference_videos","max":3},"count_allow_custom":true,"count_toward_total":true,"max_reference_images":1,"min_reference_images":0}'::jsonb,
    'upstream', '{
      "map":{"duration":"seconds","orientation":"aspect_ratio","reference_audios":"audio_urls","reference_images":"image_urls","reference_videos":"video_urls"},
      "static":{"seconds":5,"aspect_ratio":"9:16"},
      "include":["duration","orientation","aspect_ratio","reference_images","reference_videos","reference_audios","generate_audio"],
      "poll_path":"/v1/video/generations/{id}",
      "strip_params":["category_source","user_prompt"],
      "poll_timeout_sec":1800,
      "poll_interval_sec":5,
      "request_timeout_sec":120
    }'::jsonb
  )
WHERE code = 'seedance2.0-720p';

-- ------------------------------------------------------------- wan3.0-15s
UPDATE models SET
  input_schema = '{"type":"object","properties":{"count":{"enum":[1,3,5,10,30,50],"type":"integer","title":"生成数量","x-icon":"layers","default":1,"maximum":50,"minimum":1,"x-order":1,"x-widget":"option_menu","x-highlight":true,"x-allow-custom":true},"duration":{"enum":["4s","8s","12s"],"type":"string","title":"视频时长","x-icon":"clock","default":"4s","x-order":2,"x-widget":"option_menu"},"orientation":{"enum":["portrait","landscape"],"type":"string","title":"画面方向","x-icon":"ratio","default":"portrait","x-order":3,"x-widget":"option_menu","enumLabels":{"portrait":"竖屏","landscape":"横屏"}}}}'::jsonb,
  default_params = '{"count":1,"duration":"4s","orientation":"portrait"}'::jsonb,
  runtime_rule = runtime_rule || jsonb_build_object(
    'video', '{"frames":{"last":{"key":"last_frame","max":1,"label":"尾帧"},"first":{"key":"first_frame","max":1,"label":"首帧"}},"count_max":50,"mode_param":"generation_mode","prompt_hint":"","show_channel":false,"count_options":[1,3,5,10,30,50],"upload_profile":"single_ref","prompt_required":true,"show_web_search":false,"max_total_images":9,"reference_audios":{"key":"reference_audios","max":3},"reference_images":{"key":"reference_images","max":4},"reference_videos":{"key":"reference_videos","max":3},"count_allow_custom":true,"count_toward_total":true,"max_reference_images":1,"min_reference_images":0}'::jsonb,
    'upstream', '{
      "map":{"duration":"duration_seconds","orientation":"aspect_ratio","reference_audios":"referenceAudios","reference_images":"referenceImages","reference_videos":"referenceVideos"},
      "static":{"resolution":"720p","aspect_ratio":"9:16","duration_seconds":5},
      "include":["duration","orientation","aspect_ratio","resolution","reference_images","reference_videos","reference_audios"],
      "poll_path":"/v1/videos/{id}",
      "strip_params":["category_source","user_prompt"],
      "poll_timeout_sec":1800,
      "poll_interval_sec":5,
      "request_timeout_sec":120
    }'::jsonb
  )
WHERE code = 'wan3.0-15s';

-- ------------------------------------------------------------- minimax_h3
UPDATE models SET
  input_schema = '{"type":"object","properties":{"count":{"enum":[1,3,5,10,30,50],"type":"integer","title":"生成数量","x-icon":"layers","default":1,"maximum":50,"minimum":1,"x-order":1,"x-widget":"option_menu","x-highlight":true,"x-allow-custom":true},"duration":{"enum":["4s","8s","12s"],"type":"string","title":"视频时长","x-icon":"clock","default":"4s","x-order":2,"x-widget":"option_menu"},"orientation":{"enum":["portrait","landscape"],"type":"string","title":"画面方向","x-icon":"ratio","default":"portrait","x-order":3,"x-widget":"option_menu","enumLabels":{"portrait":"竖屏","landscape":"横屏"}}}}'::jsonb,
  default_params = '{"count":1,"duration":"4s","orientation":"portrait"}'::jsonb,
  runtime_rule = runtime_rule || jsonb_build_object(
    'video', '{"frames":{"last":{"key":"last_frame","max":1,"label":"尾帧"},"first":{"key":"first_frame","max":1,"label":"首帧"}},"count_max":50,"mode_param":"generation_mode","prompt_hint":"","show_channel":false,"count_options":[1,3,5,10,30,50],"upload_profile":"single_ref","prompt_required":true,"show_web_search":false,"max_total_images":9,"reference_audios":{"key":"reference_audios","max":3},"reference_images":{"key":"reference_images","max":4},"reference_videos":{"key":"reference_videos","max":3},"count_allow_custom":true,"count_toward_total":true,"max_reference_images":1,"min_reference_images":0}'::jsonb,
    'upstream', '{
      "map":{"duration":"duration_seconds","orientation":"aspect_ratio"},
      "static":{"resolution":"768","aspect_ratio":"9:16","duration_seconds":5},
      "include":["duration","orientation","aspect_ratio","resolution","reference_images","reference_videos","reference_audios"],
      "poll_path":"/v1/videos/{id}",
      "strip_params":["category_source","user_prompt"],
      "poll_timeout_sec":1800,
      "poll_interval_sec":5,
      "request_timeout_sec":120
    }'::jsonb
  )
WHERE code = 'minimax_h3';
