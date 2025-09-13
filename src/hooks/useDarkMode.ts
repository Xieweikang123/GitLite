import { useState, useEffect } from 'react'

export function useDarkMode() {
  const [isDark, setIsDark] = useState(() => {
    // 检查本地存储中的主题设置
    const saved = localStorage.getItem('dark-mode')
    if (saved !== null) {
      return JSON.parse(saved)
    }
    // 如果没有保存的设置，检查系统偏好
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    // 保存到本地存储
    localStorage.setItem('dark-mode', JSON.stringify(isDark))
    
    // 切换 HTML 元素的 class
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])

  const toggleDarkMode = () => {
    setIsDark(!isDark)
  }

  return {
    isDark,
    toggleDarkMode
  }
}
