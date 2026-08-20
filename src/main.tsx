import React, { lazy } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { RouterProvider } from '@/utils/router'
import { registerComponents } from '@/utils/componentRouter'

const HomePage = lazy(() => import('@pages/index.page'))
const TimePage = lazy(() => import('@pages/time/Time.page'))
const AlarmsPage = lazy(() => import('@pages/alarms/Alarms.page'))
const RemindersPage = lazy(() => import('@pages/reminders/Reminders.page'))
const SettingsPage = lazy(() => import('@pages/settings/Settings.page'))
const BleLabPage = lazy(() => import('@pages/ble-lab/BleLabEnhanced.page'))

registerComponents({
  '/': HomePage,
  '/time': TimePage,
  '/time/Time': TimePage,
  '/alarms': AlarmsPage,
  '/alarms/Alarms': AlarmsPage,
  '/reminders': RemindersPage,
  '/reminders/Reminders': RemindersPage,
  '/events': RemindersPage,
  '/settings': SettingsPage,
  '/settings/Settings': SettingsPage,
  '/ble-lab': BleLabPage,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RouterProvider>
    <App />
  </RouterProvider>,
)
