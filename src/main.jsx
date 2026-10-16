import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './contexts/ThemeContext'
import { DemoProvider } from './demo/DemoContext'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <DemoProvider>
        <App />
      </DemoProvider>
    </ThemeProvider>
  </React.StrictMode>
)
