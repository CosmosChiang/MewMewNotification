(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  root.MEWMEW_STORE_LISTING = data;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => ({
  version: '1.5.0',
  locales: {
    en: {
      name: 'English',
      shortDescription: 'Stay on top of Redmine updates with a searchable inbox, change digests, and focused desktop alerts.',
      detailedDescription: [
        'MewMewNotification keeps Redmine work visible without making you live in another tab.',
        '• Searchable notification inbox with Unread, Read, and All views',
        '• Change digests for subject, status, priority, and assignee updates',
        '• Quick reply, status changes, assignee updates, and Markdown preview',
        '• Quiet hours, short-window bundling, project filters, and flexible check intervals',
        '• Safe desktop actions: open the validated issue or mark the retained notification read when supported',
        '• API keys stay in local extension storage and are never synchronized across devices',
        '• English, Traditional Chinese, Simplified Chinese, and Japanese interfaces'
      ],
      releaseNotes: 'Version 1.5.0 adds a searchable notification inbox, change digests, quiet hours, bundled updates, safer profile-isolated state, local-only credential storage, improved accessibility, and hardened desktop notification actions.',
      scenes: [
        { title: 'Your Redmine inbox, organized', body: 'Search retained updates and switch between Unread, Read, and All views without losing useful history.', chips: ['Search', 'Unread / Read / All', 'Badge count'], caption: 'Searchable Redmine notification inbox with unread, read, and all views.' },
        { title: 'See exactly what changed', body: 'Change digests highlight subject, status, priority, and assignee updates at a glance.', chips: ['Change digest', 'Bundled updates', 'Clear context'], caption: 'Issue cards summarize important Redmine field changes.' },
        { title: 'Handle issues from the popup', body: 'Reply, update status, reassign work, and preview Markdown from the notification card.', chips: ['Quick reply', 'Status update', 'Markdown preview'], caption: 'Quick reply and issue actions directly in the extension popup.' },
        { title: 'Tune alerts to your workflow', body: 'Use quiet hours, short-window bundling, filters, and flexible intervals to reduce interruption.', chips: ['Quiet hours', 'Smart bundling', 'Project filters'], caption: 'Notification focus controls reduce noise while retaining updates.' },
        { title: 'Safe desktop actions', body: 'Open a validated issue or mark the local notification read when your platform supports buttons. API keys remain local-only.', chips: ['Local-only API key', 'Validated issue links', 'Profile isolated'], caption: 'Secure local credentials and platform-dependent desktop notification actions.' }
      ]
    },
    zh_TW: {
      name: '繁體中文',
      shortDescription: '透過可搜尋收件匣、變更摘要與專注型桌面提醒，即時掌握 Redmine 更新。',
      detailedDescription: [
        'MewMewNotification 讓你不必一直停留在 Redmine 分頁，也能掌握工作更新。',
        '• 可搜尋的通知收件匣，支援未讀、已讀與全部檢視',
        '• 顯示主旨、狀態、優先度與負責人差異的變更摘要',
        '• 快速回覆、變更狀態、改派負責人與 Markdown 預覽',
        '• 安靜時段、短時間通知合併、專案篩選與彈性檢查間隔',
        '• 安全桌面操作：在平台支援時開啟已驗證 issue，或標記本機通知為已讀',
        '• API key 僅保存在擴充功能本機儲存空間，不會跨裝置同步',
        '• 支援英文、繁體中文、簡體中文與日文介面'
      ],
      releaseNotes: '1.5.0 新增可搜尋通知收件匣、變更摘要、安靜時段與通知合併，並強化 Profile 狀態隔離、本機憑證儲存、無障礙操作及桌面通知安全性。',
      scenes: [
        { title: 'Redmine 通知井然有序', body: '搜尋保留的更新，並在未讀、已讀與全部檢視間切換，不遺失重要紀錄。', chips: ['快速搜尋', '未讀／已讀／全部', '徽章計數'], caption: '可搜尋的 Redmine 通知收件匣，支援未讀、已讀與全部檢視。' },
        { title: '一眼看懂哪裡改變', body: '變更摘要清楚標示主旨、狀態、優先度與負責人的更新。', chips: ['變更摘要', '合併更新', '清楚脈絡'], caption: 'Issue 卡片集中顯示重要 Redmine 欄位變更。' },
        { title: '直接在 Popup 處理 Issue', body: '從通知卡片快速回覆、變更狀態、改派工作，並預覽 Markdown。', chips: ['快速回覆', '狀態更新', 'Markdown 預覽'], caption: '直接在擴充功能 Popup 快速回覆及處理 issue。' },
        { title: '通知節奏由你掌控', body: '透過安靜時段、短時間合併、專案篩選與彈性間隔降低干擾。', chips: ['安靜時段', '智慧合併', '專案篩選'], caption: '通知專注控制降低干擾，同時保留重要更新。' },
        { title: '安全可靠的桌面操作', body: '平台支援時可開啟已驗證 issue 或標記本機通知已讀；API key 永遠只存於本機。', chips: ['API key 僅存本機', '驗證 Issue 連結', 'Profile 隔離'], caption: '本機憑證與依平台支援的安全桌面通知操作。' }
      ]
    },
    zh_CN: {
      name: '简体中文',
      shortDescription: '通过可搜索收件箱、变更摘要和专注型桌面提醒，及时掌握 Redmine 更新。',
      detailedDescription: [
        'MewMewNotification 让你无需一直停留在 Redmine 页面，也能掌握工作更新。',
        '• 可搜索的通知收件箱，支持未读、已读和全部视图',
        '• 显示主题、状态、优先级和负责人差异的变更摘要',
        '• 快速回复、变更状态、改派负责人和 Markdown 预览',
        '• 勿扰时段、短时间通知合并、项目筛选和灵活检查间隔',
        '• 安全桌面操作：平台支持时打开已验证的问题，或将本地通知标记为已读',
        '• API 密钥仅保存在扩展程序本地存储中，不会跨设备同步',
        '• 支持英语、繁体中文、简体中文和日语界面'
      ],
      releaseNotes: '1.5.0 新增可搜索通知收件箱、变更摘要、勿扰时段和通知合并，并强化配置状态隔离、本地凭据存储、无障碍操作及桌面通知安全性。',
      scenes: [
        { title: 'Redmine 通知井然有序', body: '搜索保留的更新，并在未读、已读和全部视图之间切换，不错过重要记录。', chips: ['快速搜索', '未读／已读／全部', '徽标计数'], caption: '可搜索的 Redmine 通知收件箱，支持未读、已读和全部视图。' },
        { title: '一眼看懂哪些内容改变', body: '变更摘要清楚标示主题、状态、优先级和负责人的更新。', chips: ['变更摘要', '合并更新', '清晰脉络'], caption: '问题卡片集中显示重要 Redmine 字段变更。' },
        { title: '直接在弹窗中处理问题', body: '从通知卡片快速回复、变更状态、改派工作并预览 Markdown。', chips: ['快速回复', '状态更新', 'Markdown 预览'], caption: '直接在扩展程序弹窗中快速回复并处理问题。' },
        { title: '通知节奏由你掌控', body: '通过勿扰时段、短时间合并、项目筛选和灵活间隔减少打扰。', chips: ['勿扰时段', '智能合并', '项目筛选'], caption: '通知专注控制减少干扰，同时保留重要更新。' },
        { title: '安全可靠的桌面操作', body: '平台支持时可打开已验证的问题或标记本地通知已读；API 密钥始终仅存本地。', chips: ['API 密钥仅存本地', '验证问题链接', '配置隔离'], caption: '本地凭据和依平台支持的安全桌面通知操作。' }
      ]
    },
    ja: {
      name: '日本語',
      shortDescription: '検索できる受信トレイ、変更ダイジェスト、集中しやすいデスクトップ通知で Redmine 更新を把握。',
      detailedDescription: [
        'MewMewNotification は Redmine のタブを開き続けなくても作業の更新を確認できます。',
        '• 未読、既読、すべてを切り替えられる検索対応の通知受信トレイ',
        '• 件名、ステータス、優先度、担当者の変更ダイジェスト',
        '• クイック返信、ステータス変更、担当者変更、Markdown プレビュー',
        '• 通知しない時間帯、短時間の更新統合、プロジェクト絞り込み、柔軟な確認間隔',
        '• 安全なデスクトップ操作：対応環境では検証済みチケットを開くか、ローカル通知を既読化',
        '• API キーは拡張機能のローカルストレージだけに保存され、端末間で同期されません',
        '• 英語、繁体字中国語、簡体字中国語、日本語に対応'
      ],
      releaseNotes: '1.5.0 では検索対応の通知受信トレイ、変更ダイジェスト、通知しない時間帯、更新統合に加え、プロファイル分離、ローカル認証情報、アクセシビリティ、デスクトップ通知操作を強化しました。',
      scenes: [
        { title: 'Redmine 通知を整理', body: '保存された更新を検索し、未読、既読、すべてを切り替えて大切な履歴を確認できます。', chips: ['検索', '未読／既読／すべて', 'バッジ件数'], caption: '未読、既読、すべてを切り替えられる Redmine 通知受信トレイ。' },
        { title: '変更点がひと目で分かる', body: '件名、ステータス、優先度、担当者の更新を変更ダイジェストで確認できます。', chips: ['変更ダイジェスト', '更新の統合', '明確な差分'], caption: 'Redmine の重要なフィールド変更をチケットカードに表示。' },
        { title: 'ポップアップから課題を操作', body: '通知カードから返信、ステータス変更、担当者変更、Markdown プレビューができます。', chips: ['クイック返信', 'ステータス変更', 'Markdown'], caption: '拡張機能のポップアップから返信や課題操作を実行。' },
        { title: '通知のペースを最適化', body: '通知しない時間帯、短時間の更新統合、絞り込み、確認間隔で割り込みを減らします。', chips: ['通知しない時間帯', 'スマート統合', 'プロジェクト絞り込み'], caption: '重要な更新を残しながら通知による割り込みを軽減。' },
        { title: '安全なデスクトップ操作', body: '対応環境では検証済み課題を開くかローカル通知を既読化。API キーはローカル保存のみです。', chips: ['API キーはローカルのみ', '検証済みリンク', 'プロファイル分離'], caption: 'ローカル認証情報と環境対応時の安全なデスクトップ通知操作。' }
      ]
    }
  }
})));
