import { useState } from 'react'
import { Companies } from './screens/Companies'
import { Jobs } from './screens/Jobs'
import { Settings } from './screens/Settings'

type Screen = 'jobs' | 'companies' | 'settings'

const NAV: { screen: Screen; label: string; icon: string }[] = [
  { screen: 'jobs', label: 'Jobs', icon: '☰' },
  { screen: 'companies', label: 'Companies', icon: '▤' },
  { screen: 'settings', label: 'Settings', icon: '⚙' }
]

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('jobs')
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">JOB-AUTO</div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.screen}
              className={n.screen === screen ? 'nav active' : 'nav'}
              aria-current={n.screen === screen ? 'page' : undefined}
              onClick={() => setScreen(n.screen)}
            >
              <span className="nav-icon" aria-hidden>
                {n.icon}
              </span>
              {n.label}
            </button>
          ))}
        </nav>
      </aside>
      <main>
        {screen === 'jobs' && <Jobs />}
        {screen === 'companies' && <Companies />}
        {screen === 'settings' && <Settings />}
      </main>
    </div>
  )
}

export default App
