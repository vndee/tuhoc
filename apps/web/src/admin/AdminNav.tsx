import { NavLink } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageProvider';

function subnavClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'admin-subnav-link active' : 'admin-subnav-link';
}

/**
 * Shared sub-navigation across the three `/admin/*` screens
 * (`AdminCourses` — Task 8/15, `AdminCredits`/`AdminPricing` — Task 17).
 * Without it, the two screens Task 17 adds are reachable only by typing
 * their URL by hand: `routes.tsx` mounts all three behind `AdminGuard` but
 * (like `AdminCourses` before this task) has no link pointing at any of
 * them from elsewhere in the app — this component is the one place an
 * operator who lands on ANY of the three can reach the other two.
 */
export function AdminNav() {
  const { t } = useLanguage();
  return (
    <nav className="admin-subnav" aria-label={t('admin.nav.aria')}>
      <NavLink to="/admin" end className={subnavClass}>
        {t('admin.nav.courses')}
      </NavLink>
      <NavLink to="/admin/credits" className={subnavClass}>
        {t('admin.nav.credits')}
      </NavLink>
      <NavLink to="/admin/pricing" className={subnavClass}>
        {t('admin.nav.pricing')}
      </NavLink>
    </nav>
  );
}

export default AdminNav;
