import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Button, Result } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import AppLoader from '@renderer/components/layout/AppLoader';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
const Conversation = React.lazy(() => import('@renderer/pages/conversation'));
const Guid = React.lazy(() => import('@renderer/pages/guid'));
const AgentSettings = React.lazy(() => import('@renderer/pages/settings/AgentSettings'));
const AssistantSettings = React.lazy(() => import('@renderer/pages/settings/AssistantSettings'));
const ExpertsSettings = React.lazy(() => import('@renderer/pages/settings/ExpertsSettings'));
const CapabilitiesSettings = React.lazy(() => import('@renderer/pages/settings/CapabilitiesSettings'));
const AppearanceSettings = React.lazy(() => import('@renderer/pages/settings/AppearanceSettings'));
const ModeSettings = React.lazy(() => import('@renderer/pages/settings/ModeSettings'));
const SystemSettings = React.lazy(() => import('@renderer/pages/settings/SystemSettings'));
const WebuiSettings = React.lazy(() => import('@renderer/pages/settings/WebuiSettings'));
const ClientSettings = React.lazy(() => import('@renderer/pages/settings/ClientSettings'));
const UsersSettings = React.lazy(() => import('@renderer/pages/settings/UsersSettings'));
const PetSettings = React.lazy(() => import('@renderer/pages/settings/PetSettings'));
const ExtensionSettingsPage = React.lazy(() => import('@renderer/pages/settings/ExtensionSettingsPage'));
const LoginPage = React.lazy(() => import('@renderer/pages/login'));
const ComponentsShowcase = React.lazy(() => import('@renderer/pages/TestShowcase'));
const ScheduledTasksPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage'));
const TaskDetailPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage/TaskDetailPage'));
const TeamIndex = React.lazy(() => import('@renderer/pages/team'));
const ToolboxPage = React.lazy(() => import('@renderer/pages/toolbox'));
const WorkbenchPage = React.lazy(() => import('@renderer/pages/workbench'));
const AppStorePage = React.lazy(() => import('@renderer/pages/appstore'));
const AdvisorsPage = React.lazy(() => import('@renderer/pages/advisors/AdvisorsPage'));
const ContentHubPage = React.lazy(() => import('@renderer/pages/contentHub'));

function isDynamicImportFetchError(error: Error): boolean {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    error.message
  );
}

/** Shown in place of a crashed page (instead of blanking the whole app). */
const RouteErrorFallback: React.FC<{ error: Error; onRetry: () => void }> = ({ error, onRetry }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const shouldReload = isDynamicImportFetchError(error);
  const handleRetry = () => {
    if (shouldReload) {
      window.location.reload();
      return;
    }
    onRetry();
  };

  return (
    <div className='flex h-full w-full items-center justify-center p-24px'>
      <Result
        status='error'
        title={t('common.routeError.title', { defaultValue: '页面出错了' })}
        subTitle={
          <span className='block max-w-480px break-all text-12px text-[color:var(--color-text-3)]'>
            {error.message || t('common.routeError.unknown', { defaultValue: '发生未知错误' })}
          </span>
        }
        extra={[
          <Button key='retry' type='primary' onClick={handleRetry}>
            {t('common.routeError.retry', { defaultValue: '重试' })}
          </Button>,
          <Button key='home' onClick={() => navigate('/guid')}>
            {t('common.routeError.home', { defaultValue: '返回首页' })}
          </Button>,
        ]}
      />
    </div>
  );
};

type RouteErrorBoundaryProps = { resetKey: string; children: React.ReactNode };
type RouteErrorBoundaryState = { error: Error | null };

/**
 * Catches render-time throws in a routed page so ONE broken page shows a
 * recoverable error panel instead of white-screening the entire app (the
 * renderer has no other error boundary). Resets automatically when the route
 * (`resetKey`) changes, so navigating away recovers.
 */
class RouteErrorBoundary extends React.Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Surface in DevTools so a crashed page can be diagnosed, not silently blanked.
    console.error('[RouteErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(prev: RouteErrorBoundaryProps): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return <RouteErrorFallback error={this.state.error} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

/** Per-route boundary keyed by pathname so a different route (or param) resets it. */
const RouteBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  return <RouteErrorBoundary resetKey={location.pathname}>{children}</RouteErrorBoundary>;
};

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <RouteBoundary>
    <Suspense fallback={<AppLoader />}>
      <Component />
    </Suspense>
  </RouteBoundary>
);

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return React.cloneElement(layout);
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  return (
    <HashRouter>
      <Routes>
        <Route
          path='/login'
          element={status === 'authenticated' ? <Navigate to='/guid' replace /> : withRouteFallback(LoginPage)}
        />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<Navigate to='/guid' replace />} />
          <Route path='/guid' element={withRouteFallback(Guid)} />
          <Route path='/conversation/:id' element={withRouteFallback(Conversation)} />
          <Route
            path='/team/:id'
            element={TEAM_MODE_ENABLED ? withRouteFallback(TeamIndex) : <Navigate to='/guid' replace />}
          />
          <Route path='/settings/model' element={withRouteFallback(ModeSettings)} />
          <Route path='/settings/assistants' element={withRouteFallback(AssistantSettings)} />
          <Route path='/settings/experts' element={withRouteFallback(ExpertsSettings)} />
          <Route path='/settings/agent' element={withRouteFallback(AgentSettings)} />
          <Route path='/settings/capabilities' element={withRouteFallback(CapabilitiesSettings)} />
          {/* Legacy routes — redirect to the merged /settings/capabilities page */}
          <Route path='/settings/skills-hub' element={<Navigate to='/settings/capabilities?tab=skills' replace />} />
          <Route path='/settings/tools' element={<Navigate to='/settings/capabilities?tab=tools' replace />} />
          <Route path='/settings/appearance' element={withRouteFallback(AppearanceSettings)} />
          <Route path='/settings/display' element={<Navigate to='/settings/appearance' replace />} />
          <Route path='/settings/webui' element={withRouteFallback(WebuiSettings)} />
          <Route path='/settings/client' element={withRouteFallback(ClientSettings)} />
          <Route path='/settings/users' element={withRouteFallback(UsersSettings)} />
          <Route path='/settings/pet' element={withRouteFallback(PetSettings)} />
          <Route path='/settings/system' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/about' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          <Route path='/settings' element={<Navigate to='/settings/model' replace />} />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
          <Route path='/toolbox' element={withRouteFallback(ToolboxPage)} />
          <Route path='/workbench' element={withRouteFallback(WorkbenchPage)} />
          <Route path='/appstore' element={withRouteFallback(AppStorePage)} />
          <Route path='/advisors' element={withRouteFallback(AdvisorsPage)} />
          <Route path='/files' element={withRouteFallback(ContentHubPage)} />
          <Route path='/scheduled' element={withRouteFallback(ScheduledTasksPage)} />
          <Route path='/scheduled/:job_id' element={withRouteFallback(TaskDetailPage)} />
        </Route>
        <Route path='*' element={<Navigate to={status === 'authenticated' ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
