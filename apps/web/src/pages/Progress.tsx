import { useStats } from '../api/stats';
import { useLanguage } from '../i18n/LanguageProvider';

/**
 * Tiến độ — nơi các con số THUỘC VỀ.
 *
 * Trước đây `streakDays` và `totalMinutes` sống trên trang chủ, nên màn hình
 * đầu tiên của một người dùng mới là **hai số 0 to đùng** thay vì một lời mời
 * bắt đầu. Đặc tả IA (`docs/superpowers/specs/2026-08-23-ia-redesign.md`) tách
 * chúng ra đây và trả trang chủ về đúng việc của nó: một hành động rõ.
 *
 * Con số kể chuyện bằng CÂU, không phải ô đếm rời — một người đọc câu
 * "đã học 42 phút trong 7 ngày qua" hiểu ngay, còn "42" đứng một mình dưới chữ
 * "phút đã học" thì phải tự ghép lại.
 */
export function Progress() {
  const { t } = useLanguage();
  const statsQuery = useStats();

  return (
    <div className="prog">
      <h1 className="ch-title">{t('nav.progress')}</h1>

      {statsQuery.isPending && <p className="ch-lede">{t('progress.loading')}</p>}
      {statsQuery.isError && <p className="ch-lede">{t('progress.error')}</p>}

      {statsQuery.data != null && (
        <>
          <p className="prog-sentence">
            {t(
              'progress.sentence',
              String(Math.round(statsQuery.data.totalMinutes)),
              String(statsQuery.data.streakDays),
            )}
          </p>

          <section className="prog-section">
            <h2 className="prog-h">{t('progress.byCourse')}</h2>
            {statsQuery.data.courses.length === 0 ? (
              <p className="ch-lede">{t('progress.noCourses')}</p>
            ) : (
              <ul className="prog-list">
                {statsQuery.data.courses.map((c: { courseId: string; chaptersDone: number }) => (
                  <li key={c.courseId} className="prog-row">
                    <span className="prog-row-id">{c.courseId}</span>
                    <span className="prog-row-n">
                      {t('progress.chaptersDone', String(c.chaptersDone))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default Progress;
