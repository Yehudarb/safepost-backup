// Central translation dictionary for the dashboard.
// Keys are grouped loosely by the component/area they're used in — grouping
// is just for readability while editing, it has no effect on lookup.
export const translations = {
    en: {
        toggleLanguage: 'Switch language',
        toggleTheme: 'Toggle theme',

        // StatusRing
        statusRingTasksLabel: 'tasks',

        // MissionCard / MissionCardCompact (shared)
        selectTaskAria: 'Select task',
        editTaskAria: 'Edit task',
        editTitle: 'Edit',
        cancelTaskAria: 'Cancel task',
        cancelTitle: 'Cancel',
        retryLabel: 'Retry',
        deleteTaskAria: 'Delete task',
        deleteTitle: 'Delete',

        // Ticker
        noRecentActivity: 'No recent activity',

        // CommandPalette
        commandPaletteAria: 'Search action',
        searchActionPlaceholder: 'Search action...',
        searchActionButton: 'Search action',

        // FacebookAccountPill
        connectedLabel: 'Connected',
        notConnectedLabel: 'Not connected',
        disconnectedLabel: 'Disconnected',
        connectedFbAccountAria: 'Connected Facebook account: {name}',
        openInFacebook: 'Open in Facebook',
        noProfileConnected: 'No profile connected',
        openLabel: 'Open',

        // Content edit actions
        contentActionEmojis: 'Emojis',
        contentActionShorten: 'Shorten',
        contentActionExpand: 'Expand',
        contentActionFormal: 'Formal',
        contentActionHashtags: 'Hashtags',
        contentActionToHebrew: 'To Hebrew',

        // Events / toasts / confirms
        eventTaskStatus: 'Task #{id} ← {status}',
        eventGroupsSynced: 'Groups synced successfully',
        groupSyncFailed: 'Group sync failed: {error}',
        eventWorkerStopped: 'Worker stopped',
        eventWorkerResumed: 'Worker resumed successfully',
        confirmClearAllGroups: "⚠️ This action will delete all your groups. This cannot be undone!\n\nAre you sure you want to continue?",
        allGroupsDeletedToast: 'All groups deleted successfully. Sync again to load groups.',
        errorWithMessage: 'Error: {message}',
        postsQueuedEvent: 'Post added to {count} groups successfully',
        confirmFixStuckTasks: '⚠️ This action will mark stuck tasks as FAILED. Continue?',
        stuckTasksFixedToast: 'Fixed {count} stuck tasks',
        syncTimeoutWarning: 'Sync took too long. Check that the extension is running and Facebook is open.',
        syncFailedError: 'Sync failed',

        // Command palette items
        newTaskLabel: 'New task',
        startWorkerLabel: 'Start Worker',
        stopWorkerLabel: 'Stop Worker',
        fixStuckTasksLabel: 'Fix stuck tasks',
        refreshDataLabel: 'Refresh data',
        hideAnalyticsLabel: 'Hide analytics',
        analyticsLabel: 'Analytics',
        connectedDevicesLabel: 'Connected devices',

        // Header / hero band
        workerStoppedBanner: "⏸ Worker is currently stopped — no tasks will run until it's resumed",
        quickActionsTitle: 'Quick actions',
        quickActionsSubtitle: 'Quick actions to manage your queue and system',
        connectedAccountLabel: 'Connected account',
        syncGroupsButton: 'Sync groups',
        newPostButton: 'New post',

        // Status ring legend
        statusPending: 'Pending',
        statusProcessing: 'Processing',
        statusCompleted: 'Completed',
        statusFailed: 'Failed',
        stoppedLabel: 'Stopped',
        activeLabel: 'Active',

        // Mission queue heading
        taskManagementHeading: 'Task management',
        queueCountSummary: '{filtered} of {total} tasks',

        // Queue search & filters
        queueSearchAria: 'Search tasks by content, group, or status',
        queueSearchPlaceholder: 'Search by content, group, or status',
        clearQueueSearchAria: 'Clear task search',
        filterAll: 'All ({count})',
        filterActive: 'Active ({count})',
        filterDone: 'Done ({count})',
        filterFailed: 'Failed ({count})',

        // Queue toolbar actions
        cancelCountButton: 'Cancel {count}',
        releaseCountButton: 'Release {count}',
        deselectAllButton: 'Deselect all',
        selectAllButton: 'Select all',
        fullViewButton: 'Full view',
        compactViewButton: 'Compact view',
        showQueueButton: 'Show queue',
        collapseQueueButton: 'Collapse queue',
        deleteCountButton: 'Delete {count}',

        // Drawer (new post)
        closeAria: 'Close',
        postContentLabel: 'Post content',
        variantsToggleTitle: 'Send different content variants to different groups (round-robin) and segment results in analytics',
        savedTemplatesAria: 'Saved templates',
        noTemplatesSavedYet: 'No saved templates yet.',
        deleteTemplateAria: 'Delete template {name}',
        availableTagsLabel: 'Available tags:',
        variantsExplanation: 'Each group will receive one of the variants below, round-robin. Results will be segmented by variant in analytics.',
        variantNameAria: 'Variant name {n}',
        removeVariantAria: 'Remove variant {label}',
        variantContentPlaceholder: 'Variant {label} content...',
        addVariantButton: '+ Add variant',
        disableAiSpinAria: 'Disable AI Smart Spin',
        enableAiSpinAria: 'Enable AI Smart Spin',

        // Media section
        mediaFileLabel: 'Media file',
        removeLabel: 'Remove',
        uploadMediaPrompt: 'Click to upload a media file',

        // Facebook account selector
        fbAccountSelectorLabel: '👤 Facebook Account (choose the Facebook account to post from)',
        fbUsernamePlaceholder: 'Enter a username (e.g. alice, bob)',
        clearLabel: 'Clear',

        // Blocked (moderation) groups notice
        groupWordSingular: 'group',
        groupWordPlural: 'groups',
        waitingSingular: 'is waiting',
        waitingPlural: 'are waiting',
        forAdminApprovalOnFacebook: 'for admin approval on Facebook',
        includingLabel: 'Including:',
        andMoreCount: 'and {count} more',
        blockedGroupsExplanation: "You can't send new tasks to these until the group admins approve or disable moderation.",

        // Groups panel
        selectGroupsLabel: 'Select groups ({count})',
        showSelectedFirstTitle: 'Show selected first',
        selectedStarButton: '★ Selected',
        resetOrderButton: '↺ Reset',
        syncingEllipsis: 'Syncing...',
        deleteAllGroupsTitle: 'Delete all groups and re-sync',
        deleteAllButton: 'Delete all',
        savedFoldersAria: 'Saved folders',
        allLabel: 'All',
        noFoldersSavedYet: 'No saved folders yet.',
        deleteFolderAria: 'Delete folder {name}',
        selectedCountLabel: '{count} selected',
        clearAllButton: 'Clear all',
        removeGroupAria: 'Remove group {name}',
        searchGroupsPlaceholder: 'Search groups...',
        searchGroupsAria: 'Search groups',
        clearSearchAria: 'Clear search',
        selectAllFilteredButton: 'Select all ({count})',
        noGroupsMatchSearch: 'No results for "{query}"',
        noGroupsAvailableYet: 'No groups available yet.',
        groupPendingApprovalTitle: 'This group is awaiting admin approval on Facebook',
        pendingApprovalBadge: '⏳ Awaiting approval',
        healthScoreTitle: 'Health score: {score}/100',
        timezoneTagTitle: 'Timezone: {tz}',
        tagTimezoneManual: 'Tag a timezone for the group (manual)',
        timezoneExamplePlaceholder: 'Example: Asia/Jerusalem',
        saveLabel: 'Save',
    },
    he: {
        toggleLanguage: 'החלף שפה',
        toggleTheme: 'החלף ערכת נושא',

        // StatusRing
        statusRingTasksLabel: 'משימות',

        // MissionCard / MissionCardCompact (shared)
        selectTaskAria: 'בחר משימה',
        editTaskAria: 'ערוך משימה',
        editTitle: 'ערוך',
        cancelTaskAria: 'בטל משימה',
        cancelTitle: 'בטל',
        retryLabel: 'נסה שוב',
        deleteTaskAria: 'מחק משימה',
        deleteTitle: 'מחק',

        // Ticker
        noRecentActivity: 'אין פעילות אחרונה במערכת',

        // CommandPalette
        commandPaletteAria: 'חיפוש פעולה',
        searchActionPlaceholder: 'חפש פעולה...',
        searchActionButton: 'חפש פעולה',

        // FacebookAccountPill
        connectedLabel: 'מחובר',
        notConnectedLabel: 'לא מחובר',
        disconnectedLabel: 'מנותק',
        connectedFbAccountAria: 'חשבון פייסבוק מחובר: {name}',
        openInFacebook: 'פתח בפייסבוק',
        noProfileConnected: 'אין פרופיל מחובר',
        openLabel: 'פתח',

        // Content edit actions
        contentActionEmojis: "אמוג'ים",
        contentActionShorten: 'קצר',
        contentActionExpand: 'הרחב',
        contentActionFormal: 'פורמלי',
        contentActionHashtags: 'האשטאגים',
        contentActionToHebrew: 'לעברית',

        // Events / toasts / confirms
        eventTaskStatus: 'משימה #{id} ← {status}',
        eventGroupsSynced: 'הקבוצות סונכרנו בהצלחה',
        groupSyncFailed: 'סנכרון קבוצות נכשל: {error}',
        eventWorkerStopped: 'Worker הופסק',
        eventWorkerResumed: 'Worker חודש בהצלחה',
        confirmClearAllGroups: '⚠️ פעולה זו תמחק את כל הקבוצות שלך. לא ניתן לשחזר!\n\nהאם אתה בטוח שברצונך להמשיך.',
        allGroupsDeletedToast: 'כל הקבוצות נמחקו בהצלחה. סנכרן מחדש כדי לטעון קבוצות.',
        errorWithMessage: 'שגיאה: {message}',
        postsQueuedEvent: 'פרסום נוסף ל-{count} קבוצות בהצלחה',
        confirmFixStuckTasks: '⚠️ פעולה זו תסמן משימות תקועות כ-FAILED. האם להמשיך?',
        stuckTasksFixedToast: 'תוקנו {count} משימות תקועות',
        syncTimeoutWarning: 'הסנכרון לקח יותר מדי זמן. בדוק שה-extension פועל ופייסבוק פתוח.',
        syncFailedError: 'הסנכרון נכשל',

        // Command palette items
        newTaskLabel: 'משימה חדשה',
        startWorkerLabel: 'הפעל Worker',
        stopWorkerLabel: 'עצור Worker',
        fixStuckTasksLabel: 'תקן משימות תקועות',
        refreshDataLabel: 'רענן נתונים',
        hideAnalyticsLabel: 'הסתר אנליטיקה',
        analyticsLabel: 'אנליטיקה',
        connectedDevicesLabel: 'מכשירים מחוברים',

        // Header / hero band
        workerStoppedBanner: '⏸ Worker מושבת כרגע — לא יבוצעו משימות עד להפעלה מחדש',
        quickActionsTitle: 'פעולות מהירות',
        quickActionsSubtitle: 'פעולות מהירות לניהול התור והמערכת שלך',
        connectedAccountLabel: 'חשבון מחובר',
        syncGroupsButton: 'סנכרון קבוצות',
        newPostButton: 'פוסט חדש',

        // Status ring legend
        statusPending: 'ממתין',
        statusProcessing: 'בעיבוד',
        statusCompleted: 'הושלם',
        statusFailed: 'נכשל',
        stoppedLabel: 'מושבת',
        activeLabel: 'פעיל',

        // Mission queue heading
        taskManagementHeading: 'ניהול המשימות',
        queueCountSummary: '{filtered} מתוך {total} משימות',

        // Queue search & filters
        queueSearchAria: 'חיפוש משימות לפי תוכן, קבוצה או סטטוס',
        queueSearchPlaceholder: 'חיפוש לפי תוכן, קבוצה או סטטוס',
        clearQueueSearchAria: 'נקה חיפוש משימות',
        filterAll: 'הכל ({count})',
        filterActive: 'פעיל ({count})',
        filterDone: 'הושלם ({count})',
        filterFailed: 'נכשל ({count})',

        // Queue toolbar actions
        cancelCountButton: 'בטל {count}',
        releaseCountButton: 'שחרר {count}',
        deselectAllButton: 'בטל בחירה',
        selectAllButton: 'בחר הכל',
        fullViewButton: 'תצוגה מלאה',
        compactViewButton: 'תצוגה קומפקטית',
        showQueueButton: 'הצג תור',
        collapseQueueButton: 'כווץ תור',
        deleteCountButton: 'מחק {count}',

        // Drawer (new post)
        closeAria: 'סגור',
        postContentLabel: 'תוכן הפוסט',
        variantsToggleTitle: 'שלח גרסאות תוכן שונות לקבוצות שונות (round-robin) ופלח את התוצאות באנליטיקס',
        savedTemplatesAria: 'תבניות שמורות',
        noTemplatesSavedYet: 'אין תבניות שמורות עדיין.',
        deleteTemplateAria: 'מחק תבנית {name}',
        availableTagsLabel: 'תגיות זמינות:',
        variantsExplanation: 'כל קבוצה תקבל אחת מהגרסאות למטה, לפי סבב (round-robin). התוצאות יפולחו לפי גרסה באנליטיקס.',
        variantNameAria: 'שם גרסה {n}',
        removeVariantAria: 'הסר גרסה {label}',
        variantContentPlaceholder: 'תוכן גרסה {label}...',
        addVariantButton: '+ הוסף גרסה',
        disableAiSpinAria: 'כבה AI Smart Spin',
        enableAiSpinAria: 'הפעל AI Smart Spin',

        // Media section
        mediaFileLabel: 'קובץ מדיה',
        removeLabel: 'הסר',
        uploadMediaPrompt: 'לחץ להעלאת קובץ מדיה',

        // Facebook account selector
        fbAccountSelectorLabel: '👤 Facebook Account (בחר את חשבון הפייסבוק לפרסום)',
        fbUsernamePlaceholder: 'כתוב שם יוזר (למשל: alice, bob)',
        clearLabel: 'נקה',

        // Blocked (moderation) groups notice
        groupWordSingular: 'קבוצה',
        groupWordPlural: 'קבוצות',
        waitingSingular: 'מחכה',
        waitingPlural: 'מחכות',
        forAdminApprovalOnFacebook: 'לאישור מנהל בפייסבוק',
        includingLabel: 'כולל:',
        andMoreCount: 'ועוד {count}',
        blockedGroupsExplanation: 'אתה לא יכול לשלוח אליהן משימות חדשות עד שמנהלי הקבוצה יאשרו או יכבו את ה-moderation.',

        // Groups panel
        selectGroupsLabel: 'בחר קבוצות ({count})',
        showSelectedFirstTitle: 'הצג נבחרות ראשונות',
        selectedStarButton: '★ נבחרות',
        resetOrderButton: '↺ אפס',
        syncingEllipsis: 'מסנכרן...',
        deleteAllGroupsTitle: 'מחק את כל הקבוצות וסנכרן מחדש',
        deleteAllButton: 'מחק הכל',
        savedFoldersAria: 'תיקיות שמורות',
        allLabel: 'הכל',
        noFoldersSavedYet: 'אין תיקיות שמורות עדיין.',
        deleteFolderAria: 'מחק תיקייה {name}',
        selectedCountLabel: '{count} נבחרו',
        clearAllButton: 'נקה הכל',
        removeGroupAria: 'הסר קבוצה {name}',
        searchGroupsPlaceholder: 'חיפוש קבוצות...',
        searchGroupsAria: 'חיפוש קבוצות',
        clearSearchAria: 'נקה חיפוש',
        selectAllFilteredButton: 'בחר הכל ({count})',
        noGroupsMatchSearch: 'אין תוצאות ל- "{query}"',
        noGroupsAvailableYet: 'אין קבוצות זמינות עדיין.',
        groupPendingApprovalTitle: 'קבוצה זו מחכה לאישור מנהל בפייסבוק',
        pendingApprovalBadge: '⏳ מחכה לאישור',
        healthScoreTitle: 'ציון בריאות: {score}/100',
        timezoneTagTitle: 'אזור זמן: {tz}',
        tagTimezoneManual: 'תייג אזור זמן לקבוצה (ידני)',
        timezoneExamplePlaceholder: 'לדוגמה: Asia/Jerusalem',
        saveLabel: 'שמור',
    },
};
