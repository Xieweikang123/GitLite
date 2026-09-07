use chrono::{Datelike, DateTime, FixedOffset, Utc};
use git2::Repository;

/// 将「以东经分钟数」转为 `FixedOffset`（与前端 `-Date.getTimezoneOffset()` 一致），并限制在合理范围。
pub fn fixed_offset_from_east_minutes(minutes: i32) -> FixedOffset {
    let clamped = minutes.clamp(-18 * 60, 18 * 60);
    let secs = clamped.saturating_mul(60);
    FixedOffset::east_opt(secs).unwrap_or_else(|| FixedOffset::east_opt(0).unwrap())
}

/// 提交作者时间戳对应的 UTC 时刻，再换算到指定时区墙上时钟。
/// `client_offset_east_minutes`：`Some` 时使用界面本机时区（与热力图格子 `yyyy-MM-dd` 一致）；`None` 时使用 Git 作者签名中的时区偏移。
pub fn commit_calendar_datetime(
    commit: &git2::Commit,
    client_offset_east_minutes: Option<i32>,
) -> DateTime<FixedOffset> {
    let when = commit.author().when();
    let utc = DateTime::<Utc>::from_timestamp(when.seconds(), 0)
        .unwrap_or_else(|| DateTime::<Utc>::from_timestamp(0, 0).unwrap());
    match client_offset_east_minutes {
        Some(m) => utc.with_timezone(&fixed_offset_from_east_minutes(m)),
        None => {
            let off = FixedOffset::east_opt(when.offset_minutes() * 60)
                .unwrap_or_else(|| FixedOffset::east_opt(0).unwrap());
            utc.with_timezone(&off)
        }
    }
}

pub fn commit_display_time(commit: &git2::Commit, client_offset_east_minutes: Option<i32>) -> String {
    commit_calendar_datetime(commit, client_offset_east_minutes)
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

pub fn time_bucket_key(dt: &DateTime<FixedOffset>, granularity: &str) -> String {
    let d = dt.date_naive();
    match granularity {
        "day" => d.format("%Y-%m-%d").to_string(),
        "month" => d.format("%Y-%m").to_string(),
        "week" => {
            let iso = d.iso_week();
            format!("{}-W{:02}", iso.year(), iso.week())
        }
        _ => d.format("%Y-%m").to_string(),
    }
}

pub fn display_time_from_unix_ts(secs: i64, client_calendar_offset_east_minutes: Option<i32>) -> String {
    let utc = DateTime::<Utc>::from_timestamp(secs, 0)
        .unwrap_or_else(|| DateTime::<Utc>::from_timestamp(0, 0).unwrap());
    match client_calendar_offset_east_minutes {
        Some(m) => utc
            .with_timezone(&fixed_offset_from_east_minutes(m))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string(),
        None => utc.format("%Y-%m-%d %H:%M:%S").to_string(),
    }
}

pub fn days_since(now_secs: i64, then_secs: i64) -> Option<u64> {
    if now_secs < then_secs {
        return Some(0);
    }
    Some(((now_secs - then_secs) / 86_400) as u64)
}

pub fn days_between(start_secs: i64, end_secs: i64) -> Option<u64> {
    if end_secs < start_secs {
        return Some(0);
    }
    Some(((end_secs - start_secs) / 86_400) as u64)
}

/// 当前分支的短名（HEAD 的 shorthand），失败时返回空串。
pub fn current_branch_label(repo: &Repository) -> String {
    repo.head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_default()
}
