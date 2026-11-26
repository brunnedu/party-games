import type { GameDefinition } from '../../core/game'
import { wavelengthApi } from './api'
import { WavelengthLogo } from './Logo'
import { s } from './strings.de'
import { WavelengthGame } from './WavelengthGame'

export const wavelength: GameDefinition = {
  id: 'wavelength',
  name: s.name,
  description: s.description,
  Logo: WavelengthLogo,
  color: '#f2c9a0',
  minPlayers: 2,
  maxPlayers: 10,
  start: wavelengthApi.start,
  View: WavelengthGame,
}
