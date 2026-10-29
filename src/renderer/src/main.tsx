import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@xterm/xterm/css/xterm.css'
import ReactDOM from 'react-dom/client'
import { App } from '@renderer/App'
import { prepareWorkspaceApi } from '@renderer/browser/webPreview'
import '@renderer/styles.css'
import appLogo from '../../assets/logo.png'

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/png'
favicon.href = appLogo
if (!favicon.parentNode) {
  document.head.appendChild(favicon)
}

void prepareWorkspaceApi().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
})
