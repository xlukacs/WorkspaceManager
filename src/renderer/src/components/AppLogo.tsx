import React from 'react'
import appLogo from '../../../assets/logo.png'
import appLogoWithTitle from '../../../assets/logo_with_title.png'

interface AppLogoProps {
  withTitle?: boolean
  className?: string
}

export function AppLogo({ withTitle = false, className }: AppLogoProps) {
  return (
    <img
      src={withTitle ? appLogoWithTitle : appLogo}
      alt="Workspace Manager"
      className={className}
      draggable={false}
    />
  )
}
