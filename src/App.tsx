import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Anchor,
  Ban,
  Bomb,
  Bot,
  CircleHelp,
  CirclePlus,
  Flag,
  Flame,
  Gauge,
  Globe2,
  Link2,
  Menu,
  Network,
  RotateCcw,
  Settings,
  Shield,
  Sparkle,
  TriangleAlert,
  Users,
  VolumeX,
} from 'lucide-react'
import './App.css'

type Player = 'BLACK' | 'WHITE'
type AppPage = 'menu' | 'local-settings' | 'ability-setup' | 'game'
type GameMode = 'local' | 'cpu'
type PieceType =
  | 'NORMAL'
  | 'LANCE'
  | 'BLAST'
  | 'BARRIER'
  | 'SEAL'
  | 'DROP'
  | 'CHARGE'
  | 'DAMAGE'
  | 'SILENCE'
  | 'TRAP'
  | 'GUARDIAN'
  | 'MINEFIELD'
  | 'SNARE'
type SpecialPiece = Exclude<PieceType, 'NORMAL'>
type StatusType = 'GUARD' | 'WARD' | 'CHARGE' | 'SILENCE' | 'TRAP'
type Coord = { x: number; y: number }
type Direction = { dx: number; dy: number; key: string }

type Status = {
  type: StatusType
  expiresAtTurn?: number
  charges?: number
  rewardPlayer?: Player
  resolveAtTurn?: number
}

type Disc = {
  owner: Player
  piece: PieceType
  statuses: Status[]
}

type Cell = {
  coord: Coord
  disc: Disc | null
}

type Reserve = Record<SpecialPiece, number>

type CapturedLine = {
  dir: Direction
  coords: Coord[]
  beyond: Coord
}

type MoveResult = Coord & {
  captured: CapturedLine[]
}

type MatchEvent = {
  turn: number
  player: Player
  piece: PieceType
  at: Coord
  captured: number
  special: string
}

type VisualEffect = {
  coord: Coord
  type:
    | 'flip'
    | 'guard'
    | 'ward'
    | 'block'
    | 'place'
    | 'charge'
    | 'combo'
    | 'damage'
    | 'silence'
    | 'silence-end'
    | 'trap'
    | 'trap-trigger'
}

type SpecialResult = {
  count: number
  label: string
  effects: VisualEffect[]
}

type PreviewCell = {
  className: string
  icon?: PieceType
}

type PendingBarrier = {
  move: Coord
  baseWarded: Coord[]
  selected: Coord[]
  captured: number
  comboLabel?: string
}

type PendingTrap = {
  move: Coord
  baseTrapped: Coord[]
  selected: Coord[]
  captured: number
  comboLabel?: string
}

type MatchState = {
  board: Cell[]
  rules: GameRules
  currentPlayer: Player
  turn: number
  passesInRow: 0 | 1 | 2
  specialPoints: Record<Player, number>
  reserve: Record<Player, Reserve>
  winner: Player | 'DRAW' | null
  events: MatchEvent[]
  visualEffects: VisualEffect[]
  placementBlocks: PlacementBlock[]
  damageCells: DamageCell[]
  silenceZones: SilenceZone[]
  cooldowns: Record<Player, Partial<Record<SpecialPiece, number>>>
  trapLockPending: Record<Player, number>
  trapLockActive: Record<Player, boolean>
  damageCostPending: Record<Player, number>
  damageCostActive: Record<Player, boolean>
}

type GameRules = {
  maxSpecialPoints: number
  maxDeckSize: number
  cooldownsEnabled: boolean
}

type PlacementBlock = {
  coord: Coord
  blockedFor: Player
  expiresAtTurn: number
}

type DamageCell = {
  coord: Coord
  damageFor: Player
  silenceExpiresAtTurn?: number
}

type SilenceZone = {
  coords: Coord[]
  silencedPlayer: Player
  expiresAtTurn: number
}

const boardSize = 8
const cpuPlayer: Player = 'WHITE'
const specialPieces: SpecialPiece[] = [
  'SEAL',
  'DROP',
  'BARRIER',
  'CHARGE',
  'DAMAGE',
  'TRAP',
  'GUARDIAN',
  'MINEFIELD',
  'SNARE',
  'SILENCE',
  'BLAST',
  'LANCE',
]
const defaultDecks: Record<Player, SpecialPiece[]> = {
  BLACK: ['SEAL', 'DAMAGE', 'BARRIER'],
  WHITE: ['CHARGE', 'BLAST', 'LANCE'],
}
const defaultGameRules: GameRules = {
  maxSpecialPoints: 5,
  maxDeckSize: 3,
  cooldownsEnabled: true,
}

const initialCustomRules: GameRules = {
  maxSpecialPoints: 8,
  maxDeckSize: 5,
  cooldownsEnabled: false,
}

function clampRuleValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function limitDecks(decks: Record<Player, SpecialPiece[]>, limit: number): Record<Player, SpecialPiece[]> {
  return {
    BLACK: decks.BLACK.slice(0, limit),
    WHITE: decks.WHITE.slice(0, limit),
  }
}
const directions: Direction[] = [-1, 0, 1].flatMap((dy) =>
  [-1, 0, 1]
    .filter((dx) => dx !== 0 || dy !== 0)
    .map((dx) => ({ dx, dy, key: `${dx}:${dy}` })),
)
const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const rows = ['1', '2', '3', '4', '5', '6', '7', '8']
const specialCost: Record<PieceType, number> = {
  NORMAL: 0,
  LANCE: 5,
  CHARGE: 4,
  BLAST: 3,
  BARRIER: 3,
  SEAL: 1,
  DROP: 1,
  DAMAGE: 2,
  SILENCE: 2,
  TRAP: 3,
  GUARDIAN: 5,
  MINEFIELD: 4,
  SNARE: 5,
}

const comboPieces = new Set<PieceType>([
  'SEAL',
  'DROP',
  'BARRIER',
  'BLAST',
  'DAMAGE',
  'SILENCE',
  'TRAP',
])

const pieceInfo: Record<
  PieceType,
  { label: string; short: string; tone: string; summary: string; hint: string }
> = {
  NORMAL: {
    label: '通常',
    short: 'N',
    tone: 'normal',
    summary: '普通のリバーシ駒です。',
    hint: '通常の合法手として配置し、挟んだ石を返します。',
  },
  LANCE: {
    label: 'リバース',
    short: 'R',
    tone: 'lance',
    summary: '相手の石を1枚直接返します。',
    hint: '盤上の相手石を1枚選び、その石を直接自分の色に返します。角と保護中の石は対象外です。欲しい場所をすぐ取り返したい時に使います。',
  },
  BLAST: {
    label: 'ブラスト',
    short: 'B',
    tone: 'blast',
    summary: '周囲8マスの相手駒をすべて返します。',
    hint: '置いた場所の周囲8マスにある相手駒をすべて追加で返します。角と保護中の石は対象外です。',
  },
  BARRIER: {
    label: 'アンカー',
    short: 'A',
    tone: 'anchor',
    summary: '置いた石と選んだ自分の石を守ります。',
    hint: '置いた駒自身にバリアを付け、さらに盤上の自分の石を最大2枚選んでバリアを付けます。バリアは相手に返されそうになるまで持続し、その反転を1回防ぎます。',
  },
  SEAL: {
    label: 'シール',
    short: 'S',
    tone: 'seal',
    summary: '周囲の空きマスを相手だけ封鎖します。',
    hint: '合法手として置いた後、置いた石の周囲8マスにある空きマスを、次の相手ターン終了まで相手だけ置けないマスにします。',
  },
  DROP: {
    label: 'ドロップ',
    short: 'D',
    tone: 'drop',
    summary: 'ランダムな空きマスに自分の石を置きます。',
    hint: '使用すると、盤上の空いているマスからランダムに1つ選ばれ、自分の色の石を直接置きます。その石を起点に追加反転も発生します。',
  },
  CHARGE: {
    label: 'チャージ',
    short: 'C',
    tone: 'charge',
    summary: 'その石の現在の色のSPを回復します。',
    hint: 'チャージ駒は返されても効果を失いません。発動時点でその石を持っているプレイヤーのSPを1回復します。',
  },
  DAMAGE: {
    label: 'ダメージ',
    short: 'G',
    tone: 'damage',
    summary: '相手の能力コストを上げるマスを作ります。',
    hint: '配置時、周囲8マスの空きマスをダメージマスにします。相手がそのマスに石を置くと、相手の次のターンは能力の使用コストが+1されます。コンボ時は自分のダメージマスの周囲にある空きマス1つへダメージマスを広げます。',
  },
  SILENCE: {
    label: 'サイレンス',
    short: 'Q',
    tone: 'silence',
    summary: '相手の能力と盤面効果を一時的に封印します。',
    hint: '配置時、円形範囲20マスにある相手の能力駒、バリア、罠、自分に効く相手のダメージマスを次の自分のターン終了時まで封印します。封印範囲内に相手が新たに置いた能力駒の無効化は相手のターン終了時まで続きます。コンボ時も同じ効果が発動します。',
  },
  TRAP: {
    label: 'トラップ',
    short: 'T',
    tone: 'trap',
    summary: '返されると相手の次ターンを妨害します。',
    hint: '置いた駒自身と追加で選んだ自分の駒2つに罠を付与します。相手が罠付き駒を返すと、相手の次ターンはSP自然回復が止まり、能力も使用不可になります。罠は一度返されると消えます。コンボ時は自分のランダムな駒1つに罠を付与します。',
  },
  GUARDIAN: {
    label: 'ガーディアン',
    short: 'U',
    tone: 'guardian',
    summary: '存在中、自ターン終了時にバリアを付与します。',
    hint: 'この駒が自分の色で盤上に存在する限り、自分のターン終了時にランダムな自分の駒2つへバリアを付与します。封印中は発動しません。',
  },
  MINEFIELD: {
    label: 'マイン',
    short: 'M',
    tone: 'minefield',
    summary: '存在中、自ターン終了時にダメージマスを作ります。',
    hint: 'この駒が自分の色で盤上に存在する限り、自分のターン終了時にランダムな空きマス1つを相手用ダメージマスにします。封印中は発動しません。',
  },
  SNARE: {
    label: 'スネア',
    short: 'E',
    tone: 'snare',
    summary: '存在中、自ターン終了時に通常駒へ罠を付けます。',
    hint: 'この駒が自分の色で盤上に存在する限り、自分のターン終了時に能力を持たない自分の駒1つへ罠を付与します。封印中は発動しません。',
  },
}

const positionWeights = [
  [120, -35, 20, 5, 5, 20, -35, 120],
  [-35, -60, -8, -8, -8, -8, -60, -35],
  [20, -8, 15, 3, 3, 15, -8, 20],
  [5, -8, 3, 3, 3, 3, -8, 5],
  [5, -8, 3, 3, 3, 3, -8, 5],
  [20, -8, 15, 3, 3, 15, -8, 20],
  [-35, -60, -8, -8, -8, -8, -60, -35],
  [120, -35, 20, 5, 5, 20, -35, 120],
]

function createInitialState(rules: GameRules = defaultGameRules): MatchState {
  const board = Array.from({ length: boardSize * boardSize }, (_, index) => {
    const coord = indexToCoord(index)
    let disc: Disc | null = null

    if ((coord.x === 3 && coord.y === 3) || (coord.x === 4 && coord.y === 4)) {
      disc = createDisc('WHITE', 'NORMAL')
    }

    if ((coord.x === 4 && coord.y === 3) || (coord.x === 3 && coord.y === 4)) {
      disc = createDisc('BLACK', 'NORMAL')
    }

    return { coord, disc }
  })

  return {
    board,
    rules: { ...rules },
    currentPlayer: 'BLACK',
    turn: 1,
    passesInRow: 0,
    specialPoints: { BLACK: 0, WHITE: 0 },
    reserve: {
      BLACK: createReserve(),
      WHITE: createReserve(),
    },
    winner: null,
    events: [],
    visualEffects: [],
    placementBlocks: [],
    damageCells: [],
    silenceZones: [],
    cooldowns: { BLACK: {}, WHITE: {} },
    trapLockPending: { BLACK: 0, WHITE: 0 },
    trapLockActive: { BLACK: false, WHITE: false },
    damageCostPending: { BLACK: 0, WHITE: 0 },
    damageCostActive: { BLACK: false, WHITE: false },
  }
}

function createReserve(): Reserve {
  return {
    LANCE: 0,
    BLAST: 0,
    BARRIER: 0,
    SEAL: 0,
    DROP: 0,
    CHARGE: 0,
    DAMAGE: 0,
    SILENCE: 0,
    TRAP: 0,
    GUARDIAN: 0,
    MINEFIELD: 0,
    SNARE: 0,
  }
}

function createDisc(owner: Player, piece: PieceType): Disc {
  return { owner, piece, statuses: [] }
}

function indexToCoord(index: number): Coord {
  return { x: index % boardSize, y: Math.floor(index / boardSize) }
}

function coordToIndex(coord: Coord) {
  return coord.y * boardSize + coord.x
}

function getCell(board: Cell[], coord: Coord) {
  return board[coordToIndex(coord)]
}

function isInside(coord: Coord) {
  return coord.x >= 0 && coord.x < boardSize && coord.y >= 0 && coord.y < boardSize
}

function isCorner(coord: Coord) {
  return (
    (coord.x === 0 || coord.x === boardSize - 1) &&
    (coord.y === 0 || coord.y === boardSize - 1)
  )
}

function getOpponent(player: Player): Player {
  return player === 'BLACK' ? 'WHITE' : 'BLACK'
}

function formatPlayer(player: Player) {
  return player === 'BLACK' ? 'Black' : 'White'
}

function getMoveResult(board: Cell[], player: Player, at: Coord): MoveResult | null {
  if (getCell(board, at).disc) {
    return null
  }

  const opponent = getOpponent(player)
  const captured: CapturedLine[] = []

  for (const dir of directions) {
    const coords: Coord[] = []
    let cursor = { x: at.x + dir.dx, y: at.y + dir.dy }

    while (isInside(cursor) && getCell(board, cursor).disc?.owner === opponent) {
      coords.push(cursor)
      cursor = { x: cursor.x + dir.dx, y: cursor.y + dir.dy }
    }

    if (coords.length > 0 && isInside(cursor) && getCell(board, cursor).disc?.owner === player) {
      captured.push({ dir, coords, beyond: cursor })
    }
  }

  return captured.length > 0 ? { ...at, captured } : null
}

function getLegalMoves(board: Cell[], player: Player): MoveResult[] {
  return board
    .map((cell) => getMoveResult(board, player, cell.coord))
    .filter((move): move is MoveResult => Boolean(move))
}

function getLegalMovesForState(state: MatchState, player: Player, turn = state.turn): MoveResult[] {
  return getLegalMoves(state.board, player).filter(
    (move) => !isPlacementBlocked(state, move, player, turn),
  )
}

function isPlacementBlocked(state: MatchState, coord: Coord, player: Player, turn = state.turn) {
  return state.placementBlocks.some(
    (block) =>
      block.blockedFor === player &&
      block.expiresAtTurn >= turn &&
      block.coord.x === coord.x &&
      block.coord.y === coord.y,
  )
}

function canUsePiece(state: MatchState, player: Player, piece: PieceType) {
  if (piece === 'NORMAL') {
    return true
  }

  return (
    !state.trapLockActive[player] &&
    state.specialPoints[player] >= getEffectiveSpecialCost(state, player, piece) &&
    getCooldownRemaining(state, player, piece) === 0
  )
}

function getEffectiveSpecialCost(state: MatchState, player: Player, piece: PieceType) {
  if (piece === 'NORMAL') {
    return 0
  }

  return specialCost[piece] + (state.damageCostActive[player] ? 1 : 0)
}

function getCooldownRemaining(state: MatchState, player: Player, piece: SpecialPiece) {
  return state.cooldowns[player][piece] ?? 0
}

function spendSpecialCostAndSetCooldown(state: MatchState, player: Player, piece: SpecialPiece) {
  state.specialPoints[player] -= getEffectiveSpecialCost(state, player, piece)

  if (state.rules.cooldownsEnabled) {
    state.cooldowns[player] = {
      ...state.cooldowns[player],
      [piece]: specialCost[piece] + 1,
    }
  }
}

function tickCooldowns(state: MatchState, player: Player) {
  state.cooldowns[player] = Object.fromEntries(
    Object.entries(state.cooldowns[player])
      .map(([piece, turns]) => [piece, Math.max(0, (turns ?? 0) - 1)])
      .filter(([, turns]) => Number(turns) > 0),
  ) as Partial<Record<SpecialPiece, number>>
}

function applyTrapPenalty(state: MatchState, player: Player, coord?: Coord) {
  state.trapLockPending[player] = 1
  if (coord) {
    state.visualEffects = [...state.visualEffects, { coord, type: 'trap-trigger' }]
  }
}

function applyDamageCostPenalty(state: MatchState, player: Player) {
  state.damageCostPending[player] = 1
}

function hasBlockingWard(disc: Disc, turn: number) {
  if (hasSilence(disc, turn)) {
    return false
  }

  return disc.statuses.some(
    (status) => status.type === 'WARD' && status.expiresAtTurn !== undefined && turn <= status.expiresAtTurn,
  )
}

function hasSilence(disc: Disc, turn: number) {
  return disc.statuses.some(
    (status) => status.type === 'SILENCE' && status.expiresAtTurn !== undefined && turn <= status.expiresAtTurn,
  )
}

function tryFlip(
  board: Cell[],
  coord: Coord,
  attacker: Player,
  turn: number,
  onTrapTriggered?: (player: Player, coord: Coord) => void,
) {
  const disc = getCell(board, coord).disc

  if (!disc || disc.owner === attacker || isCorner(coord)) {
    return false
  }

  if (hasBlockingWard(disc, turn)) {
    return false
  }

  const isSilenced = hasSilence(disc, turn)
  const guard = isSilenced
    ? undefined
    : disc.statuses.find((status) => status.type === 'GUARD' && (status.charges ?? 0) > 0)

  if (guard) {
    guard.charges = 0
    disc.statuses = disc.statuses.filter(
      (status) => status.type !== 'GUARD' || (status.charges ?? 0) > 0,
    )
    return false
  }

  const trapTriggered = !isSilenced && disc.statuses.some((status) => status.type === 'TRAP')
  disc.owner = attacker
  if (trapTriggered) {
    onTrapTriggered?.(attacker, coord)
  }
  for (const status of disc.statuses) {
    if (status.type === 'CHARGE') {
      status.resolveAtTurn = turn + 1
    }
  }
  disc.statuses = disc.statuses.filter(
    (status) => status.type !== 'GUARD' && status.type !== 'WARD' && status.type !== 'TRAP',
  )
  return true
}

function findChainFlips(board: Cell[], player: Player, origin: Coord) {
  const opponent = getOpponent(player)
  const flips: Coord[] = []

  for (const dir of directions) {
    const line: Coord[] = []
    let cursor = { x: origin.x + dir.dx, y: origin.y + dir.dy }

    while (isInside(cursor) && getCell(board, cursor).disc?.owner === opponent) {
      line.push(cursor)
      cursor = { x: cursor.x + dir.dx, y: cursor.y + dir.dy }
    }

    if (line.length > 0 && isInside(cursor) && getCell(board, cursor).disc?.owner === player) {
      flips.push(...line)
    }
  }

  return flips
}

function applyChainFlips(
  board: Cell[],
  player: Player,
  origins: Coord[],
  turn: number,
  onTrapTriggered?: (player: Player, coord: Coord) => void,
) {
  const flipped: Coord[] = []

  for (const origin of origins) {
    for (const target of findChainFlips(board, player, origin)) {
      if (tryFlip(board, target, player, turn, onTrapTriggered)) {
        flipped.push(target)
      }
    }
  }

  return flipped
}

function applyPlaceAction(state: MatchState, piece: PieceType, move: MoveResult) {
  const next = cloneState(state)
  const player = next.currentPlayer
  const onTrapTriggered = (targetPlayer: Player, coord: Coord) => applyTrapPenalty(next, targetPlayer, coord)
  const placedCell = getCell(next.board, move)
  placedCell.disc = createDisc(player, piece)
  const counterSilence =
    piece === 'SILENCE' ? counterSilenceZonesAt(next, move, player) : { count: 0, label: '', effects: [] }
  const zoneSilence = piece === 'SILENCE' ? { count: 0, label: '', effects: [] } : applySilenceZonesToCoord(next, move)
  const placedDisc = getCell(next.board, move).disc
  const placedSilenced = Boolean(placedDisc && hasSilence(placedDisc, next.turn))
  const earlySpecial =
    piece === 'SILENCE' && !placedSilenced
      ? resolveSpecialEffect(next, piece, move)
      : { count: 0, label: '', effects: [] }
  const comboOriginsBeforeFlip = getPlacementComboOrigins(next, move)
  const preFlipComboSilence = resolvePreFlipSilenceCombos(next, comboOriginsBeforeFlip)
  const damage =
    piece === 'SILENCE'
      ? clearDamageCellAt(next, move)
      : applyDamageCellTrigger(next, move, player)

  const flippedByRule: Coord[] = []
  for (const line of move.captured) {
    for (const coord of line.coords) {
      if (tryFlip(next.board, coord, player, next.turn, onTrapTriggered)) {
        flippedByRule.push(coord)
      }
    }
  }

  const special = placedSilenced
    ? { count: 0, label: piece !== 'NORMAL' ? 'Silenced on entry' : '', effects: [] }
    : piece === 'SILENCE'
    ? earlySpecial
    : resolveSpecialEffect(next, piece, move)
  const combo = resolveComboEffectsFromOrigins(next, comboOriginsBeforeFlip, preFlipComboSilence.origins)
  next.visualEffects = [
    ...next.visualEffects,
    ...counterSilence.effects,
    ...zoneSilence.effects,
    ...special.effects,
    ...preFlipComboSilence.effects,
    ...damage.effects,
    ...flippedByRule.map((coord) => ({ coord, type: 'flip' as const })),
    ...combo.effects,
  ]

  if (piece !== 'NORMAL') {
    spendSpecialCostAndSetCooldown(next, player, piece)
  }

  next.events = [
    {
      turn: next.turn,
      player,
      piece,
      at: { x: move.x, y: move.y },
      captured: flippedByRule.length + special.count + combo.count,
      special: [damage.label, counterSilence.label, zoneSilence.label, special.label, preFlipComboSilence.label, combo.label]
        .filter(Boolean)
        .join(' / '),
    },
    ...next.events,
  ].slice(0, 8)

  advanceTurn(next)
  return next
}

function applyBarrierPlacementStart(state: MatchState, move: MoveResult) {
  const next = cloneState(state)
  const player = next.currentPlayer
  const onTrapTriggered = (targetPlayer: Player, coord: Coord) => applyTrapPenalty(next, targetPlayer, coord)
  const placedCell = getCell(next.board, move)
  placedCell.disc = createDisc(player, 'BARRIER')
  const comboOriginsBeforeFlip = getPlacementComboOrigins(next, move)
  const preFlipComboSilence = resolvePreFlipSilenceCombos(next, comboOriginsBeforeFlip)
  const damage = applyDamageCellTrigger(next, move, player)

  const flippedByRule: Coord[] = []
  for (const line of move.captured) {
    for (const coord of line.coords) {
      if (tryFlip(next.board, coord, player, next.turn, onTrapTriggered)) {
        flippedByRule.push(coord)
      }
    }
  }

  const baseWarded = applyBaseBarrier(next, move)
  const combo = resolveComboEffectsFromOrigins(next, comboOriginsBeforeFlip, preFlipComboSilence.origins)
  spendSpecialCostAndSetCooldown(next, player, 'BARRIER')
  next.visualEffects = [
    ...next.visualEffects,
    ...preFlipComboSilence.effects,
    ...damage.effects,
    ...flippedByRule.map((coord) => ({ coord, type: 'flip' as const })),
    ...baseWarded.map((coord) => ({ coord, type: 'guard' as const })),
    ...combo.effects,
  ]

  return {
    next,
    pending: {
      move: { x: move.x, y: move.y },
      baseWarded,
      selected: [],
      captured: flippedByRule.length + combo.count,
      comboLabel: [damage.label, preFlipComboSilence.label, combo.label].filter(Boolean).join(' / '),
    },
  }
}

function applyTrapPlacementStart(state: MatchState, move: MoveResult) {
  const next = cloneState(state)
  const player = next.currentPlayer
  const onTrapTriggered = (targetPlayer: Player, coord: Coord) => applyTrapPenalty(next, targetPlayer, coord)
  const placedCell = getCell(next.board, move)
  placedCell.disc = createDisc(player, 'TRAP')
  const comboOriginsBeforeFlip = getPlacementComboOrigins(next, move)
  const preFlipComboSilence = resolvePreFlipSilenceCombos(next, comboOriginsBeforeFlip)
  const damage = applyDamageCellTrigger(next, move, player)

  const flippedByRule: Coord[] = []
  for (const line of move.captured) {
    for (const coord of line.coords) {
      if (tryFlip(next.board, coord, player, next.turn, onTrapTriggered)) {
        flippedByRule.push(coord)
      }
    }
  }

  const baseTrapped = applyBaseTrap(next, move)
  const combo = resolveComboEffectsFromOrigins(next, comboOriginsBeforeFlip, preFlipComboSilence.origins)
  spendSpecialCostAndSetCooldown(next, player, 'TRAP')
  next.visualEffects = [
    ...next.visualEffects,
    ...preFlipComboSilence.effects,
    ...damage.effects,
    ...flippedByRule.map((coord) => ({ coord, type: 'flip' as const })),
    ...baseTrapped.map((coord) => ({ coord, type: 'trap' as const })),
    ...combo.effects,
  ]

  return {
    next,
    pending: {
      move: { x: move.x, y: move.y },
      baseTrapped,
      selected: [],
      captured: flippedByRule.length + combo.count,
      comboLabel: [damage.label, preFlipComboSilence.label, combo.label].filter(Boolean).join(' / '),
    },
  }
}

function finishBarrierSelection(state: MatchState, pending: PendingBarrier) {
  const next = cloneState(state)
  const player = next.currentPlayer
  const selected = pending.selected.filter((coord) => {
    const disc = getCell(next.board, coord).disc
    return disc?.owner === player
  })

  for (const coord of selected) {
    addWard(next, coord)
  }

  const warded = uniqueCoords([...pending.baseWarded, ...selected])
  next.visualEffects = warded.map((coord) => ({ coord, type: 'guard' }))
  const event: MatchEvent = {
    turn: next.turn,
    player,
    piece: 'BARRIER',
    at: pending.move,
    captured: pending.captured,
    special: pending.comboLabel ? `Anchor x${warded.length} / ${pending.comboLabel}` : `Anchor x${warded.length}`,
  }
  next.events = [event, ...next.events].slice(0, 8)

  advanceTurn(next)
  return next
}

function finishTrapSelection(state: MatchState, pending: PendingTrap) {
  const next = cloneState(state)
  const player = next.currentPlayer
  const selected = pending.selected.filter((coord) => {
    const disc = getCell(next.board, coord).disc
    return disc?.owner === player
  })

  for (const coord of selected) {
    addTrap(next, coord)
  }

  const trapped = uniqueCoords([...pending.baseTrapped, ...selected])
  next.visualEffects = trapped.map((coord) => ({ coord, type: 'trap' }))
  const event: MatchEvent = {
    turn: next.turn,
    player,
    piece: 'TRAP',
    at: pending.move,
    captured: pending.captured,
    special: pending.comboLabel ? `Trap x${trapped.length} / ${pending.comboLabel}` : `Trap x${trapped.length}`,
  }
  next.events = [event, ...next.events].slice(0, 8)

  advanceTurn(next)
  return next
}

function applyDirectReverseAction(state: MatchState, target: Coord) {
  const next = cloneState(state)
  const player = next.currentPlayer
  const onTrapTriggered = (targetPlayer: Player, coord: Coord) => applyTrapPenalty(next, targetPlayer, coord)
  const canFlip = canSpecialFlip(next.board, target, player, next.turn)
  const comboOriginsBeforeFlip = canFlip ? getComboOriginsFromFlank(next, [target]) : []
  const preFlipComboSilence = canFlip
    ? resolvePreFlipSilenceCombos(next, comboOriginsBeforeFlip)
    : { count: 0, label: '', effects: [], origins: [] }
  const flipped = canFlip ? tryFlip(next.board, target, player, next.turn, onTrapTriggered) : false
  const comboOrigins = flipped ? getComboOriginsFromFlank(next, [target]) : []
  const chainFlips = flipped ? applyChainFlips(next.board, player, [target], next.turn, onTrapTriggered) : []
  const combo = flipped
    ? resolveComboEffectsFromOrigins(next, comboOrigins, preFlipComboSilence.origins)
    : { count: 0, label: '', effects: [] }

  if (flipped) {
    spendSpecialCostAndSetCooldown(next, player, 'LANCE')
  }

  next.visualEffects = [
    ...next.visualEffects,
    ...preFlipComboSilence.effects,
    ...(flipped ? [{ coord: target, type: 'flip' as const }] : []),
    ...chainFlips.map((coord) => ({ coord, type: 'flip' as const })),
    ...combo.effects,
  ]
  const event: MatchEvent = {
    turn: next.turn,
    player,
    piece: 'LANCE',
    at: target,
    captured: (flipped ? 1 : 0) + chainFlips.length + combo.count,
    special: flipped
      ? `Reverse +${coordLabel(target)}${chainFlips.length > 0 ? ` / chain +${chainFlips.length}` : ''}${
          preFlipComboSilence.label ? ` / ${preFlipComboSilence.label}` : ''
        }${combo.label ? ` / ${combo.label}` : ''
        }`
      : 'Reverse target blocked',
  }
  next.events = [event, ...next.events].slice(0, 8)

  advanceTurn(next)
  return next
}

function applyDirectDropAction(state: MatchState) {
  const next = cloneState(state)
  const player = next.currentPlayer
  const target = chooseRandomCoord(getDropTargets(next))
  if (!target) {
    const event: MatchEvent = {
      turn: next.turn,
      player,
      piece: 'DROP',
      at: { x: 0, y: 0 },
      captured: 0,
      special: 'Drop had no target',
    }
    next.events = [event, ...next.events].slice(0, 8)
    advanceTurn(next)
    return next
  }

  const cell = getCell(next.board, target)
  const canPlace = !cell.disc && !isPlacementBlocked(next, target, player)
  const chainFlips: Coord[] = []
  let damage: SpecialResult = { count: 0, label: '', effects: [] }
  const onTrapTriggered = (targetPlayer: Player, coord: Coord) => applyTrapPenalty(next, targetPlayer, coord)

  if (canPlace) {
    cell.disc = createDisc(player, 'DROP')
    damage = applyDamageCellTrigger(next, target, player)
    const zoneSilence = applySilenceZonesToCoord(next, target)
    chainFlips.push(...applyChainFlips(next.board, player, [target], next.turn, onTrapTriggered))
    spendSpecialCostAndSetCooldown(next, player, 'DROP')
    next.visualEffects = [
      ...next.visualEffects,
      ...damage.effects,
      ...zoneSilence.effects,
      { coord: target, type: 'place' as const },
      ...chainFlips.map((coord) => ({ coord, type: 'flip' as const })),
    ]
  }

  if (!canPlace) {
    next.visualEffects = []
  }
  const event: MatchEvent = {
    turn: next.turn,
    player,
    piece: 'DROP',
    at: target,
    captured: (canPlace ? 1 : 0) + chainFlips.length,
    special: canPlace
      ? `Drop ${coordLabel(target)}${damage.label ? ` / ${damage.label}` : ''}${
          chainFlips.length > 0 ? ` / chain +${chainFlips.length}` : ''
        }`
      : 'Drop target blocked',
  }
  next.events = [event, ...next.events].slice(0, 8)

  advanceTurn(next)
  return next
}

function chooseRandomCoord(targets: Coord[]) {
  return targets[Math.floor(Math.random() * targets.length)]
}

function cloneState(state: MatchState): MatchState {
  return {
    ...state,
    rules: { ...state.rules },
    board: state.board.map((cell) => ({
      coord: { ...cell.coord },
      disc: cell.disc
        ? {
            ...cell.disc,
            statuses: cell.disc.statuses.map((status) => ({ ...status })),
          }
        : null,
    })),
    specialPoints: {
      BLACK: state.specialPoints.BLACK,
      WHITE: state.specialPoints.WHITE,
    },
    reserve: {
      BLACK: { ...state.reserve.BLACK },
      WHITE: { ...state.reserve.WHITE },
    },
    events: [...state.events],
    visualEffects: state.visualEffects.map((effect) => ({
      coord: { ...effect.coord },
      type: effect.type,
    })),
    placementBlocks: state.placementBlocks.map((block) => ({
      coord: { ...block.coord },
      blockedFor: block.blockedFor,
      expiresAtTurn: block.expiresAtTurn,
    })),
    damageCells: state.damageCells.map((cell) => ({
      coord: { ...cell.coord },
      damageFor: cell.damageFor,
      silenceExpiresAtTurn: cell.silenceExpiresAtTurn,
    })),
    silenceZones: state.silenceZones.map((zone) => ({
      coords: zone.coords.map((coord) => ({ ...coord })),
      silencedPlayer: zone.silencedPlayer,
      expiresAtTurn: zone.expiresAtTurn,
    })),
    cooldowns: {
      BLACK: { ...state.cooldowns.BLACK },
      WHITE: { ...state.cooldowns.WHITE },
    },
    trapLockPending: {
      BLACK: state.trapLockPending.BLACK,
      WHITE: state.trapLockPending.WHITE,
    },
    trapLockActive: {
      BLACK: state.trapLockActive.BLACK,
      WHITE: state.trapLockActive.WHITE,
    },
    damageCostPending: {
      BLACK: state.damageCostPending.BLACK,
      WHITE: state.damageCostPending.WHITE,
    },
    damageCostActive: {
      BLACK: state.damageCostActive.BLACK,
      WHITE: state.damageCostActive.WHITE,
    },
  }
}

function resolveSpecialEffect(state: MatchState, piece: PieceType, move: MoveResult): SpecialResult {
  switch (piece) {
    case 'LANCE':
      return resolveReverse(state, move)
    case 'BLAST':
      return resolveBlast(state, move)
    case 'BARRIER':
      return resolveBarrier(state, move)
    case 'SEAL':
      return resolveSeal(state, move)
    case 'CHARGE':
      return resolveCharge(state, move)
    case 'DAMAGE':
      return resolveDamage(state, move)
    case 'SILENCE':
      return resolveSilence(state, move)
    case 'TRAP':
      return resolveTrapAuto(state, move)
    case 'GUARDIAN':
      return {
        count: 0,
        label: 'Guardian aura armed',
        effects: [{ coord: move, type: 'guard' }],
      }
    case 'MINEFIELD':
      return {
        count: 0,
        label: 'Mine aura armed',
        effects: [{ coord: move, type: 'damage' }],
      }
    case 'SNARE':
      return {
        count: 0,
        label: 'Snare aura armed',
        effects: [{ coord: move, type: 'trap' }],
      }
    default:
      return { count: 0, label: 'standard flip', effects: [] }
  }
}

function resolveReverse(state: MatchState, move: MoveResult): SpecialResult {
  const player = state.currentPlayer
  const onTrapTriggered = (targetPlayer: Player, coord: Coord) => applyTrapPenalty(state, targetPlayer, coord)
  const candidates = getReverseTargets(state)
    .filter((target) => !sameSquare(target, move))
    .sort((a, b) => positionWeights[b.y][b.x] - positionWeights[a.y][a.x])

  const target = candidates[0]

  if (!target) {
    return { count: 0, label: 'Reverse had no target', effects: [] }
  }

  const flipped = tryFlip(state.board, target, player, state.turn, onTrapTriggered)
  const chainFlips = flipped ? applyChainFlips(state.board, player, [target], state.turn, onTrapTriggered) : []

  return {
    count: (flipped ? 1 : 0) + chainFlips.length,
    label: `Reverse +${coordLabel(target)}${chainFlips.length > 0 ? ` / chain +${chainFlips.length}` : ''}`,
    effects: [
      ...(flipped ? [{ coord: target, type: 'flip' as const }] : []),
      ...chainFlips.map((coord) => ({ coord, type: 'flip' as const })),
    ],
  }
}

function sameSquare(a: Coord, b: Coord) {
  return a.x === b.x && a.y === b.y
}

function getReverseTargets(state: MatchState) {
  return state.board
    .map((cell) => cell.coord)
    .filter((target) => canSpecialFlip(state.board, target, state.currentPlayer, state.turn))
}

function getDropTargets(state: MatchState) {
  return state.board
    .filter((cell) => !cell.disc)
    .map((cell) => cell.coord)
    .filter((target) => !isPlacementBlocked(state, target, state.currentPlayer))
}

function getBarrierTargets(state: MatchState, pending: PendingBarrier) {
  const baseWarded = new Set(pending.baseWarded.map((coord) => `${coord.x}-${coord.y}`))
  return state.board
    .filter((cell) => cell.disc?.owner === state.currentPlayer)
    .map((cell) => cell.coord)
    .filter((coord) => !baseWarded.has(`${coord.x}-${coord.y}`))
}

function getTrapTargets(state: MatchState, pending: PendingTrap) {
  const baseTrapped = new Set(pending.baseTrapped.map((coord) => `${coord.x}-${coord.y}`))
  return state.board
    .filter((cell) => cell.disc?.owner === state.currentPlayer)
    .map((cell) => cell.coord)
    .filter((coord) => !baseTrapped.has(`${coord.x}-${coord.y}`))
}

function getPlacementComboOrigins(state: MatchState, move: MoveResult) {
  return uniqueCoords(
    move.captured
      .map((line) => line.beyond)
      .filter((coord) => !sameSquare(coord, move))
      .filter((coord) => {
        const disc = getCell(state.board, coord).disc
        return Boolean(disc?.owner === state.currentPlayer && comboPieces.has(disc.piece) && !hasSilence(disc, state.turn))
      }),
  )
}

function getComboOriginsFromFlank(state: MatchState, origins: Coord[]) {
  const player = state.currentPlayer
  const opponent = getOpponent(player)
  const comboOrigins: Coord[] = []

  for (const origin of origins) {
    for (const dir of directions) {
      let cursor = { x: origin.x + dir.dx, y: origin.y + dir.dy }
      let hasOpponentLine = false

      while (isInside(cursor) && getCell(state.board, cursor).disc?.owner === opponent) {
        hasOpponentLine = true
        cursor = { x: cursor.x + dir.dx, y: cursor.y + dir.dy }
      }

      if (!hasOpponentLine || !isInside(cursor) || sameSquare(cursor, origin)) {
        continue
      }

      comboOrigins.push(cursor)
    }
  }

  return uniqueCoords(comboOrigins)
}

function resolvePreFlipSilenceCombos(state: MatchState, origins: Coord[]) {
  const silenceOrigins = uniqueCoords(origins).filter((coord) => {
    const disc = getCell(state.board, coord).disc
    return Boolean(disc?.owner === state.currentPlayer && disc.piece === 'SILENCE' && !hasSilence(disc, state.turn))
  })

  if (silenceOrigins.length === 0) {
    return { count: 0, label: '', effects: [], origins: [] as Coord[] }
  }

  const results = silenceOrigins.map((origin) => resolveSilence(state, origin))

  return {
    count: results.reduce((sum, result) => sum + result.count, 0),
    label: `Combo ${results.map((result) => result.label).join(' + ')}`,
    effects: [
      ...results.flatMap((result) => result.effects),
      ...silenceOrigins.map((coord) => ({ coord, type: 'combo' as const })),
    ],
    origins: silenceOrigins,
  }
}

function resolveComboEffectsFromOrigins(
  state: MatchState,
  origins: Coord[],
  excludedOrigins: Coord[] = [],
): SpecialResult {
  const excludedKeys = new Set(excludedOrigins.map((coord) => `${coord.x}-${coord.y}`))
  const activeOrigins = uniqueCoords(origins).filter((coord) => {
    const disc = getCell(state.board, coord).disc
    return Boolean(
      !excludedKeys.has(`${coord.x}-${coord.y}`) &&
        disc?.owner === state.currentPlayer &&
        comboPieces.has(disc.piece) &&
        !hasSilence(disc, state.turn),
    )
  })

  const results = activeOrigins
    .map((origin) => {
      const disc = getCell(state.board, origin).disc
      return disc ? resolveComboEffect(state, disc.piece, origin) : null
    })
    .filter((result): result is SpecialResult => Boolean(result))

  if (results.length === 0) {
    return { count: 0, label: '', effects: [] }
  }

  return {
    count: results.reduce((sum, result) => sum + result.count, 0),
    label: `Combo ${results.map((result) => result.label).join(' + ')}`,
    effects: [
      ...results.flatMap((result) => result.effects),
      ...activeOrigins.map((coord) => ({ coord, type: 'combo' as const })),
    ],
  }
}

function resolveComboEffect(state: MatchState, piece: PieceType, origin: Coord): SpecialResult {
  const move = { ...origin, captured: [] }

  if (piece === 'SEAL') {
    const result = resolveSeal(state, move)
    return { ...result, label: 'Seal' }
  }

  if (piece === 'DROP') {
    return resolveDropCombo(state, origin)
  }

  if (piece === 'BARRIER') {
    return resolveAnchorCombo(state)
  }

  if (piece === 'BLAST') {
    const result = resolveBlast(state, move)
    return { ...result, label: `Blast +${result.count}` }
  }

  if (piece === 'DAMAGE') {
    return resolveDamageCombo(state, origin)
  }

  if (piece === 'SILENCE') {
    return resolveSilence(state, move)
  }

  if (piece === 'TRAP') {
    return resolveTrapCombo(state)
  }

  return { count: 0, label: '', effects: [] }
}

function resolveAnchorCombo(state: MatchState): SpecialResult {
  const candidates = shuffleCoords(
    state.board
      .filter((cell) => cell.disc?.owner === state.currentPlayer)
      .map((cell) => cell.coord),
  ).slice(0, 3)

  const warded = candidates.filter((coord) => addWard(state, coord))

  return {
    count: 0,
    label: `Anchor x${warded.length}`,
    effects: warded.map((coord) => ({ coord, type: 'guard' as const })),
  }
}

function shuffleCoords(coords: Coord[]) {
  const shuffled = [...coords]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
  }

  return shuffled
}

function resolveDropCombo(state: MatchState, origin: Coord): SpecialResult {
  const target = chooseRandomCoord(getDropTargets(state))

  if (!target) {
    return {
      count: 0,
      label: 'Drop no target',
      effects: [{ coord: origin, type: 'combo' }],
    }
  }

  const cell = getCell(state.board, target)
  cell.disc = createDisc(state.currentPlayer, 'DROP')
  const damage = applyDamageCellTrigger(state, target, state.currentPlayer)
  const zoneSilence = applySilenceZonesToCoord(state, target)
  const onTrapTriggered = (targetPlayer: Player, coord: Coord) => applyTrapPenalty(state, targetPlayer, coord)
  const chainFlips = applyChainFlips(state.board, state.currentPlayer, [target], state.turn, onTrapTriggered)

  return {
    count: 1 + chainFlips.length,
    label: `Drop ${coordLabel(target)}${damage.label ? ` / ${damage.label}` : ''}`,
    effects: [
      ...damage.effects,
      ...zoneSilence.effects,
      { coord: target, type: 'place' },
      ...chainFlips.map((coord) => ({ coord, type: 'flip' as const })),
    ],
  }
}

function resolveTrapCombo(state: MatchState): SpecialResult {
  const target = chooseRandomCoord(
    shuffleCoords(
      state.board
        .filter((cell) => cell.disc?.owner === state.currentPlayer)
        .map((cell) => cell.coord),
    ),
  )

  if (!target || !addTrap(state, target)) {
    return { count: 0, label: 'Trap no target', effects: [] }
  }

  return {
    count: 0,
    label: `Trap ${coordLabel(target)}`,
    effects: [{ coord: target, type: 'trap' }],
  }
}

function resolveTrapAuto(state: MatchState, move: MoveResult): SpecialResult {
  const baseTrapped = applyBaseTrap(state, move)
  const candidates = shuffleCoords(
    getTrapTargets(state, {
      move,
      baseTrapped,
      selected: [],
      captured: 0,
    }),
  ).slice(0, 2)
  const selected = candidates.filter((coord) => addTrap(state, coord))
  const trapped = uniqueCoords([...baseTrapped, ...selected])

  return {
    count: 0,
    label: `Trap x${trapped.length}`,
    effects: trapped.map((coord) => ({ coord, type: 'trap' })),
  }
}

function resolveCharge(state: MatchState, move: MoveResult): SpecialResult {
  const disc = getCell(state.board, move).disc

  if (!disc || disc.owner !== state.currentPlayer) {
    return { count: 0, label: 'Charge failed', effects: [] }
  }

  disc.statuses = disc.statuses.filter((status) => status.type !== 'CHARGE')
  disc.statuses.push({
    type: 'CHARGE',
    resolveAtTurn: state.turn + 1,
  })

  return {
    count: 0,
    label: 'Charge armed',
    effects: [{ coord: move, type: 'guard' }],
  }
}

function resolveDamage(state: MatchState, move: MoveResult): SpecialResult {
  const targets = directions
    .map((dir) => ({ x: move.x + dir.dx, y: move.y + dir.dy }))
    .filter((coord) => isInside(coord) && !getCell(state.board, coord).disc)

  const damaged = addDamageCells(state, targets, getOpponent(state.currentPlayer))

  return {
    count: 0,
    label: `Damage x${damaged.length}`,
    effects: damaged.map((coord) => ({ coord, type: 'damage' as const })),
  }
}

function resolveSilence(state: MatchState, move: Coord): SpecialResult {
  const range = getSilenceRange(state, move)
  const opponent = getOpponent(state.currentPlayer)
  const zoneExpiresAtTurn = state.turn + 1
  const statusExpiresAtTurn = state.turn + 2
  const targets = getSilenceTargets(state, move)
  const rangeKeys = new Set(range.map((coord) => `${coord.x}-${coord.y}`))

  state.silenceZones = [
    ...state.silenceZones.filter((zone) => zone.expiresAtTurn >= state.turn),
    {
      coords: range,
      silencedPlayer: opponent,
      expiresAtTurn: zoneExpiresAtTurn,
    },
  ]

  for (const coord of targets) {
    const disc = getCell(state.board, coord).disc

    if (!disc) {
      continue
    }

    disc.statuses = disc.statuses.filter((status) => status.type !== 'SILENCE')
    disc.statuses.push({ type: 'SILENCE', expiresAtTurn: statusExpiresAtTurn })
  }

  const silencedDamageCells = state.damageCells
    .filter(
      (cell) =>
        cell.damageFor === state.currentPlayer &&
        rangeKeys.has(`${cell.coord.x}-${cell.coord.y}`),
    )
    .map((cell) => {
      cell.silenceExpiresAtTurn = statusExpiresAtTurn
      return cell.coord
    })

  return {
    count: 0,
    label: `Silence x${targets.length + silencedDamageCells.length}`,
    effects: range.map((coord) => ({ coord, type: 'silence' as const })),
  }
}

function getSilenceRange(state: MatchState, origin: Coord) {
  return state.board
    .map((cell) => cell.coord)
    .filter((coord) => {
      const dx = Math.abs(coord.x - origin.x)
      const dy = Math.abs(coord.y - origin.y)
      return !sameSquare(coord, origin) && dx <= 2 && dy <= 2 && !(dx === 2 && dy === 2)
    })
}

function getSilenceTargets(state: MatchState, origin: Coord) {
  const opponent = getOpponent(state.currentPlayer)
  return getSilenceRange(state, origin)
    .filter((coord) => {
      const disc = getCell(state.board, coord).disc
      return Boolean(
        disc?.owner === opponent &&
          (disc.piece !== 'NORMAL' ||
            disc.statuses.some((status) => status.type === 'GUARD' || status.type === 'WARD' || status.type === 'TRAP')),
      )
    })
}

function applySilenceZonesToCoord(state: MatchState, coord: Coord): SpecialResult {
  const disc = getCell(state.board, coord).disc

  if (!disc || disc.owner !== state.currentPlayer || disc.piece === 'NORMAL') {
    return { count: 0, label: '', effects: [] }
  }

  const activeZone = state.silenceZones.find(
    (zone) =>
      zone.silencedPlayer === disc.owner &&
      zone.expiresAtTurn >= state.turn &&
      zone.coords.some((zoneCoord) => sameSquare(zoneCoord, coord)),
  )

  if (!activeZone) {
    return { count: 0, label: '', effects: [] }
  }

  disc.statuses = disc.statuses.filter((status) => status.type !== 'SILENCE')
  disc.statuses.push({ type: 'SILENCE', expiresAtTurn: activeZone.expiresAtTurn })

  return {
    count: 0,
    label: 'Silence field',
    effects: [{ coord, type: 'silence' }],
  }
}

function counterSilenceZonesAt(state: MatchState, coord: Coord, player: Player): SpecialResult {
  const counteredZones = state.silenceZones.filter(
    (zone) =>
      zone.silencedPlayer === player &&
      zone.expiresAtTurn >= state.turn &&
      zone.coords.some((zoneCoord) => sameSquare(zoneCoord, coord)),
  )

  if (counteredZones.length === 0) {
    return { count: 0, label: '', effects: [] }
  }

  const counteredKeys = new Set(
    counteredZones.flatMap((zone) => zone.coords.map((zoneCoord) => `${zoneCoord.x}-${zoneCoord.y}`)),
  )

  state.silenceZones = state.silenceZones.filter((zone) => !counteredZones.includes(zone))

  for (const cell of state.board) {
    if (!cell.disc || cell.disc.owner !== player || !counteredKeys.has(`${cell.coord.x}-${cell.coord.y}`)) {
      continue
    }

    cell.disc.statuses = cell.disc.statuses.filter((status) => status.type !== 'SILENCE')
  }

  for (const damageCell of state.damageCells) {
    if (damageCell.damageFor === getOpponent(player) && counteredKeys.has(`${damageCell.coord.x}-${damageCell.coord.y}`)) {
      damageCell.silenceExpiresAtTurn = undefined
    }
  }

  return {
    count: 0,
    label: `Counter Silence x${counteredZones.length}`,
    effects: uniqueCoords(counteredZones.flatMap((zone) => zone.coords)).map((zoneCoord) => ({
      coord: zoneCoord,
      type: 'silence' as const,
    })),
  }
}

function isSilenceZoneForPlayer(state: MatchState, coord: Coord, player: Player) {
  return state.silenceZones.some(
    (zone) =>
      zone.silencedPlayer === player &&
      zone.expiresAtTurn >= state.turn &&
      zone.coords.some((zoneCoord) => sameSquare(zoneCoord, coord)),
  )
}

function getSilenceForDamageCell(state: MatchState, coord: Coord, damageFor: Player) {
  return state.silenceZones.find(
    (zone) =>
      zone.silencedPlayer === getOpponent(damageFor) &&
      zone.expiresAtTurn >= state.turn &&
      zone.coords.some((zoneCoord) => sameSquare(zoneCoord, coord)),
  )
}

function resolveDamageCombo(state: MatchState, origin: Coord): SpecialResult {
  return resolveDamageComboForPlayer(state, origin, state.currentPlayer)
}

function resolveDamageComboForPlayer(state: MatchState, origin: Coord, player: Player, sourceLimit = 2): SpecialResult {
  const sources = shuffleCoords(
    getOwnDamageCells(state, player)
      .map((cell) => cell.coord)
      .filter((coord) => getDamageSpreadTargetsFrom(state, coord).length > 0),
  ).slice(0, sourceLimit)

  const targets: Coord[] = []

  for (const source of sources) {
    const target = chooseRandomCoord(getDamageSpreadTargetsFrom(state, source, targets))

    if (target) {
      targets.push(target)
    }
  }

  if (targets.length === 0) {
    const fallback = getNearestDamageFallbackTarget(state, origin)

    if (fallback) {
      targets.push(fallback)
    }
  }

  if (targets.length === 0) {
    return { count: 0, label: 'Damage spread no target', effects: [] }
  }

  const damaged = addDamageCells(state, targets, getOpponent(player))

  return {
    count: damaged.length,
    label: damaged.length > 0 ? `Damage spread x${damaged.length}` : 'Damage spread no target',
    effects: damaged.map((coord) => ({ coord, type: 'damage' as const })),
  }
}

function getNearestDamageFallbackTarget(state: MatchState, origin: Coord) {
  const damageCellKeys = new Set(state.damageCells.map((cell) => `${cell.coord.x}-${cell.coord.y}`))

  return state.board
    .filter((cell) => !cell.disc && !damageCellKeys.has(`${cell.coord.x}-${cell.coord.y}`))
    .map((cell) => cell.coord)
    .toSorted(
      (a, b) =>
        distanceSquared(a, origin) - distanceSquared(b, origin) ||
        positionWeights[b.y][b.x] - positionWeights[a.y][a.x],
    )[0]
}

function distanceSquared(a: Coord, b: Coord) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}

function getOwnDamageCells(state: MatchState, player = state.currentPlayer) {
  return state.damageCells.filter((cell) => cell.damageFor === getOpponent(player))
}

function getDamageSpreadTargetsFrom(state: MatchState, source: Coord, reservedTargets: Coord[] = []) {
  const unavailableKeys = new Set([
    ...state.damageCells.map((cell) => `${cell.coord.x}-${cell.coord.y}`),
    ...reservedTargets.map((coord) => `${coord.x}-${coord.y}`),
  ])

  return cardinalDirections()
    .map((dir) => ({ x: source.x + dir.dx, y: source.y + dir.dy }))
    .filter(
      (coord) =>
        isInside(coord) &&
        !getCell(state.board, coord).disc &&
        !unavailableKeys.has(`${coord.x}-${coord.y}`),
    )
}

function cardinalDirections() {
  return directions.filter((dir) => Math.abs(dir.dx) + Math.abs(dir.dy) === 1)
}

function addDamageCells(state: MatchState, targets: Coord[], damageFor: Player) {
  const validTargets = uniqueCoords(targets).filter((coord) => !getCell(state.board, coord).disc)
  const targetKeys = new Set(validTargets.map((coord) => `${coord.x}-${coord.y}`))

  state.damageCells = [
    ...state.damageCells.filter((cell) => !targetKeys.has(`${cell.coord.x}-${cell.coord.y}`)),
    ...validTargets.map((coord) => ({
      coord,
      damageFor,
      silenceExpiresAtTurn: getSilenceForDamageCell(state, coord, damageFor)?.expiresAtTurn,
    })),
  ]

  return validTargets
}

function applyDamageCellTrigger(state: MatchState, coord: Coord, player: Player): SpecialResult {
  const target = state.damageCells.find(
    (cell) => cell.damageFor === player && cell.coord.x === coord.x && cell.coord.y === coord.y,
  )
  state.damageCells = state.damageCells.filter(
    (cell) => cell.coord.x !== coord.x || cell.coord.y !== coord.y,
  )

  if (!target) {
    return { count: 0, label: '', effects: [] }
  }

  if (isDamageCellSilenced(target, state.turn)) {
    return {
      count: 0,
      label: 'Damage silenced',
      effects: [{ coord, type: 'silence' }],
    }
  }

  applyDamageCostPenalty(state, player)

  return {
    count: 0,
    label: 'Damage next cost +1',
    effects: [{ coord, type: 'damage' }],
  }
}

function clearDamageCellAt(state: MatchState, coord: Coord): SpecialResult {
  state.damageCells = state.damageCells.filter(
    (cell) => cell.coord.x !== coord.x || cell.coord.y !== coord.y,
  )

  return { count: 0, label: '', effects: [] }
}

function isDamageCellSilenced(cell: DamageCell, turn: number) {
  return cell.silenceExpiresAtTurn !== undefined && cell.silenceExpiresAtTurn >= turn
}

function resolveSeal(state: MatchState, move: MoveResult): SpecialResult {
  const blockedFor = getOpponent(state.currentPlayer)
  const targets = directions
    .map((dir) => ({ x: move.x + dir.dx, y: move.y + dir.dy }))
    .filter((coord) => isInside(coord) && !getCell(state.board, coord).disc)

  state.placementBlocks = [
    ...state.placementBlocks.filter(
      (block) =>
        block.expiresAtTurn >= state.turn &&
        !targets.some((target) => target.x === block.coord.x && target.y === block.coord.y),
    ),
    ...targets.map((coord) => ({
      coord,
      blockedFor,
      expiresAtTurn: state.turn + 1,
    })),
  ]

  return {
    count: 0,
    label: `Seal x${targets.length}`,
    effects: targets.map((coord) => ({ coord, type: 'block' })),
  }
}

function resolveBlast(state: MatchState, move: MoveResult): SpecialResult {
  const player = state.currentPlayer
  const onTrapTriggered = (targetPlayer: Player, coord: Coord) => applyTrapPenalty(state, targetPlayer, coord)
  const targets = directions
    .map((dir) => ({ x: move.x + dir.dx, y: move.y + dir.dy }))
    .filter((target) => canSpecialFlip(state.board, target, player, state.turn))

  const flipped = targets.filter((target) => tryFlip(state.board, target, player, state.turn, onTrapTriggered))
  const chainFlips = applyChainFlips(state.board, player, flipped, state.turn, onTrapTriggered)

  return {
    count: flipped.length + chainFlips.length,
    label:
      flipped.length > 0
        ? `Blast +${flipped.length}${chainFlips.length > 0 ? ` / chain +${chainFlips.length}` : ''}`
        : 'Blast had no target',
    effects: [
      ...flipped.map((coord) => ({ coord, type: 'flip' as const })),
      ...chainFlips.map((coord) => ({ coord, type: 'flip' as const })),
    ],
  }
}

function resolveBarrier(state: MatchState, move: MoveResult): SpecialResult {
  const warded = applyBaseBarrier(state, move)

  return {
    count: 0,
    label: `Anchor x${warded.length}`,
    effects: warded.map((coord) => ({ coord, type: 'guard' })),
  }
}

function applyBaseBarrier(state: MatchState, move: MoveResult) {
  const targets = [move]
  const warded: Coord[] = []

  for (const coord of targets) {
    if (addWard(state, coord)) {
      warded.push(coord)
    }
  }

  return uniqueCoords(warded)
}

function applyBaseTrap(state: MatchState, move: MoveResult) {
  const trapped: Coord[] = []

  if (addTrap(state, move)) {
    trapped.push(move)
  }

  return trapped
}

function addWard(state: MatchState, coord: Coord) {
  return addWardForPlayer(state, coord, state.currentPlayer)
}

function addWardForPlayer(state: MatchState, coord: Coord, player: Player) {
  const disc = getCell(state.board, coord).disc

  if (disc?.owner !== player) {
    return false
  }

  disc.statuses = disc.statuses.filter((status) => status.type !== 'GUARD')
  disc.statuses.push({ type: 'GUARD', charges: 1 })
  return true
}

function addTrap(state: MatchState, coord: Coord) {
  return addTrapForPlayer(state, coord, state.currentPlayer)
}

function addTrapForPlayer(state: MatchState, coord: Coord, player: Player) {
  const disc = getCell(state.board, coord).disc

  if (disc?.owner !== player) {
    return false
  }

  disc.statuses = disc.statuses.filter((status) => status.type !== 'TRAP')
  disc.statuses.push({ type: 'TRAP' })
  return true
}

function uniqueCoords(coords: Coord[]) {
  return Array.from(new Map(coords.map((coord) => [`${coord.x}-${coord.y}`, coord])).values())
}

function canSpecialFlip(board: Cell[], target: Coord, attacker: Player, turn: number) {
  if (!isInside(target) || isCorner(target)) {
    return false
  }

  const disc = getCell(board, target).disc
  return Boolean(disc && disc.owner !== attacker && !hasBlockingWard(disc, turn))
}

function advanceTurn(state: MatchState) {
  const previousPlayer = state.currentPlayer
  resolveEndTurnAuras(state, previousPlayer)
  let nextPlayer = getOpponent(state.currentPlayer)
  let passesInRow = 0 as 0 | 1 | 2
  const upcomingTurn = state.turn + 1
  const nextMoves = getLegalMovesForState(state, nextPlayer, upcomingTurn)

  if (nextMoves.length === 0) {
    passesInRow = 1
    nextPlayer = state.currentPlayer

    if (getLegalMovesForState(state, nextPlayer, upcomingTurn).length === 0) {
      passesInRow = 2
      state.winner = getWinner(state.board)
    }
  }

  state.trapLockActive[previousPlayer] = false
  state.damageCostActive[previousPlayer] = false
  state.currentPlayer = nextPlayer
  state.turn += 1
  state.passesInRow = passesInRow

  if (!state.winner) {
    const trapLockTriggers = state.trapLockPending[state.currentPlayer] > 0
    const damageCostTriggers = state.damageCostPending[state.currentPlayer] > 0
    state.trapLockActive[state.currentPlayer] = trapLockTriggers
    state.damageCostActive[state.currentPlayer] = damageCostTriggers
    if (trapLockTriggers) {
      state.trapLockPending[state.currentPlayer] = Math.max(0, state.trapLockPending[state.currentPlayer] - 1)
    }
    if (damageCostTriggers) {
      state.damageCostPending[state.currentPlayer] = Math.max(0, state.damageCostPending[state.currentPlayer] - 1)
    }
    tickCooldowns(state, state.currentPlayer)
    if (!trapLockTriggers) {
      recoverSpecialPoint(state, state.currentPlayer)
    }
  }

  expireTurnState(state)
}

function resolveEndTurnAuras(state: MatchState, player: Player) {
  const auraPieces = state.board.filter(
    (cell) =>
      cell.disc?.owner === player &&
      (cell.disc.piece === 'GUARDIAN' || cell.disc.piece === 'MINEFIELD' || cell.disc.piece === 'SNARE') &&
      !hasSilence(cell.disc, state.turn),
  )

  if (auraPieces.length === 0) {
    return
  }

  const events: MatchEvent[] = []
  const effects: VisualEffect[] = []

  for (const cell of auraPieces) {
    if (cell.disc?.piece === 'GUARDIAN') {
      const targets = shuffleCoords(
        state.board
          .filter((targetCell) => targetCell.disc?.owner === player)
          .map((targetCell) => targetCell.coord),
      ).slice(0, 2)
      const warded = targets.filter((target) => addWardForPlayer(state, target, player))

      if (warded.length > 0) {
        effects.push(...warded.map((coord) => ({ coord, type: 'guard' as const })))
        events.push(createAuraEvent(state, player, 'GUARDIAN', cell.coord, `Guardian x${warded.length}`))
      }
    }

    if (cell.disc?.piece === 'MINEFIELD') {
      const damage = resolveDamageComboForPlayer(state, cell.coord, player, 1)

      if (damage.count > 0) {
        effects.push(...damage.effects)
        events.push(createAuraEvent(state, player, 'MINEFIELD', cell.coord, `Mine ${damage.label}`))
      }
    }

    if (cell.disc?.piece === 'SNARE') {
      const targets = shuffleCoords(
        state.board
          .filter((targetCell) => targetCell.disc?.owner === player && targetCell.disc.piece === 'NORMAL')
          .map((targetCell) => targetCell.coord),
      ).slice(0, 1)
      const trapped = targets.filter((target) => addTrapForPlayer(state, target, player))

      if (trapped.length > 0) {
        effects.push(...trapped.map((coord) => ({ coord, type: 'trap' as const })))
        events.push(createAuraEvent(state, player, 'SNARE', cell.coord, `Snare x${trapped.length}`))
      }
    }
  }

  state.visualEffects = [...state.visualEffects, ...effects]
  state.events = [...events, ...state.events].slice(0, 8)
}

function createAuraEvent(
  state: MatchState,
  player: Player,
  piece: PieceType,
  at: Coord,
  special: string,
): MatchEvent {
  return {
    turn: state.turn,
    player,
    piece,
    at: { x: at.x, y: at.y },
    captured: 0,
    special,
  }
}

function recoverSpecialPoint(state: MatchState, player: Player) {
  state.specialPoints[player] = Math.min(state.rules.maxSpecialPoints, state.specialPoints[player] + 1)
}

function expireTurnState(state: MatchState) {
  const chargeEffects: VisualEffect[] = []
  const expiredSilenceEffects = uniqueCoords(
    state.silenceZones
      .filter((zone) => zone.expiresAtTurn < state.turn)
      .flatMap((zone) => zone.coords),
  ).map((coord) => ({ coord, type: 'silence-end' as const }))

  for (const cell of state.board) {
    if (!cell.disc) {
      continue
    }

    const charges = cell.disc.statuses.filter(
      (status) =>
        status.type === 'CHARGE' &&
        !hasSilence(cell.disc!, state.turn) &&
        cell.disc?.owner === state.currentPlayer &&
        status.resolveAtTurn !== undefined &&
        status.resolveAtTurn <= state.turn,
    )

    for (const charge of charges) {
      const rewardPlayer = cell.disc.owner

      recoverSpecialPoint(state, rewardPlayer)
      charge.resolveAtTurn = state.turn + 1
      chargeEffects.push({ coord: cell.coord, type: 'charge' })
    }

    cell.disc.statuses = cell.disc.statuses.filter(
      (status) =>
        (status.type !== 'WARD' && status.type !== 'SILENCE') ||
        (status.expiresAtTurn ?? 0) >= state.turn,
    )
  }

  state.placementBlocks = state.placementBlocks.filter(
    (block) => block.expiresAtTurn >= state.turn,
  )
  state.silenceZones = state.silenceZones.filter((zone) => zone.expiresAtTurn >= state.turn)

  state.visualEffects = [...state.visualEffects, ...chargeEffects, ...expiredSilenceEffects]
}

function getWinner(board: Cell[]) {
  const score = countPieces(board)

  if (score.BLACK === score.WHITE) {
    return 'DRAW'
  }

  return score.BLACK > score.WHITE ? 'BLACK' : 'WHITE'
}

function countPieces(board: Cell[]) {
  return board.reduce(
    (score, cell) => {
      if (cell.disc) {
        score[cell.disc.owner] += 1
      }

      return score
    },
    { BLACK: 0, WHITE: 0 } satisfies Record<Player, number>,
  )
}

function chooseCpuMove(state: MatchState, moves: MoveResult[], deck: SpecialPiece[]) {
  const piece = pickCpuPiece(state, deck)

  return {
    piece,
    move: moves.toSorted((a, b) => scoreMove(b, piece) - scoreMove(a, piece))[0],
  }
}

function pickCpuPiece(state: MatchState, deck: SpecialPiece[]): PieceType {
  const usable = deck.filter((piece) => canUsePiece(state, cpuPlayer, piece))

  if (usable.includes('BLAST') && state.specialPoints[cpuPlayer] >= 2) {
    return 'BLAST'
  }

  if (usable.includes('LANCE') && getReverseTargets(state).length > 0) {
    return 'LANCE'
  }

  if (usable.includes('DROP') && getDropTargets(state).length > 0) {
    return 'DROP'
  }

  return usable[0] ?? 'NORMAL'
}

function chooseReverseTargetForCpu(state: MatchState) {
  return getReverseTargets(state).toSorted((a, b) => positionWeights[b.y][b.x] - positionWeights[a.y][a.x])[0]
}

function scoreMove(move: MoveResult, piece: PieceType) {
  const cornerBonus = isCorner(move) ? 500 : 0
  const specialBonus = piece === 'NORMAL' ? 0 : specialCost[piece] * 10
  const capturedCount = move.captured.reduce((sum, line) => sum + line.coords.length, 0)
  return positionWeights[move.y][move.x] + capturedCount * 8 + cornerBonus + specialBonus
}

function coordLabel(coord: Coord) {
  return `${columns[coord.x]}${rows[coord.y]}`
}

function coordToPercent(value: number) {
  return ((value + 0.5) / boardSize) * 100
}

function App() {
  const [page, setPage] = useState<AppPage>('menu')
  const [rules, setRules] = useState<GameRules>(defaultGameRules)
  const [customRules, setCustomRules] = useState<GameRules>(initialCustomRules)
  const [pendingRules, setPendingRules] = useState<GameRules>(defaultGameRules)
  const [state, setState] = useState(() => createInitialState(defaultGameRules))
  const [mode, setMode] = useState<GameMode>('local')
  const [decks, setDecks] = useState<Record<Player, SpecialPiece[]>>(defaultDecks)
  const [selectedPiece, setSelectedPiece] = useState<PieceType>('NORMAL')
  const [pendingBarrier, setPendingBarrier] = useState<PendingBarrier | null>(null)
  const [pendingTrap, setPendingTrap] = useState<PendingTrap | null>(null)
  const [hoveredMoveKey, setHoveredMoveKey] = useState<string | null>(null)

  const legalMoves = useMemo(
    () => getLegalMovesForState(state, state.currentPlayer),
    [state],
  )
  const moveMap = useMemo(
    () => new Map(legalMoves.map((move) => [`${move.x}-${move.y}`, move])),
    [legalMoves],
  )
  const comboPreviewMap = useMemo<Map<string, Coord[]>>(
    () =>
      new Map(
        legalMoves
          .map((move) => [`${move.x}-${move.y}`, getPlacementComboOrigins(state, move)] as const)
          .filter(([, origins]) => origins.length > 0),
      ),
    [legalMoves, state],
  )
  const visualEffectMap = useMemo(
    () => new Map(state.visualEffects.map((effect) => [`${effect.coord.x}-${effect.coord.y}`, effect.type])),
    [state.visualEffects],
  )
  const reverseTargets = useMemo(
    () => new Map(getReverseTargets(state).map((target) => [`${target.x}-${target.y}`, target])),
    [state],
  )
  const dropTargets = useMemo(
    () => new Map(getDropTargets(state).map((target) => [`${target.x}-${target.y}`, target])),
    [state],
  )
  const placementBlockMap = useMemo(
    () =>
      new Map(
        state.placementBlocks
          .filter((block) => block.blockedFor === state.currentPlayer && block.expiresAtTurn >= state.turn)
          .map((block) => [`${block.coord.x}-${block.coord.y}`, block]),
      ),
    [state],
  )
  const damageCellMap = useMemo(
    () => new Map(state.damageCells.map((cell) => [`${cell.coord.x}-${cell.coord.y}`, cell])),
    [state.damageCells],
  )
  const silenceZoneKeys = useMemo(
    () =>
      new Set(
        state.silenceZones
          .filter((zone) => zone.expiresAtTurn >= state.turn)
          .flatMap((zone) => zone.coords.map((coord) => `${coord.x}-${coord.y}`)),
      ),
    [state.silenceZones, state.turn],
  )
  const silenceZoneEdgeMap = useMemo(() => {
    const edgeMap = new Map<string, string>()

    for (const key of silenceZoneKeys) {
      const [xText, yText] = key.split('-')
      const x = Number(xText)
      const y = Number(yText)
      const edges = [
        !silenceZoneKeys.has(`${x}-${y - 1}`) ? 'silence-edge-top' : '',
        !silenceZoneKeys.has(`${x + 1}-${y}`) ? 'silence-edge-right' : '',
        !silenceZoneKeys.has(`${x}-${y + 1}`) ? 'silence-edge-bottom' : '',
        !silenceZoneKeys.has(`${x - 1}-${y}`) ? 'silence-edge-left' : '',
      ]
        .filter(Boolean)
        .join(' ')

      edgeMap.set(key, edges)
    }

    return edgeMap
  }, [silenceZoneKeys])
  const barrierTargetMap = useMemo(
    () =>
      new Map(
        pendingBarrier
          ? getBarrierTargets(state, pendingBarrier).map((target) => [`${target.x}-${target.y}`, target])
          : [],
      ),
    [pendingBarrier, state],
  )
  const trapTargetMap = useMemo(
    () =>
      new Map(
        pendingTrap
          ? getTrapTargets(state, pendingTrap).map((target) => [`${target.x}-${target.y}`, target])
          : [],
      ),
    [pendingTrap, state],
  )
  const score = useMemo(() => countPieces(state.board), [state.board])
  const hoveredMove = hoveredMoveKey ? moveMap.get(hoveredMoveKey) : undefined
  const hoveredComboOrigins = useMemo(
    () => (hoveredMoveKey ? comboPreviewMap.get(hoveredMoveKey) ?? [] : []),
    [comboPreviewMap, hoveredMoveKey],
  )
  const hoveredComboOriginKeys = useMemo(
    () => new Set(hoveredComboOrigins.map((coord) => `${coord.x}-${coord.y}`)),
    [hoveredComboOrigins],
  )
  const currentDeck = decks[state.currentPlayer]
  const cpuDeck = decks.WHITE
  const deckBuilderLimit = page === 'ability-setup' ? pendingRules.maxDeckSize : customRules.maxDeckSize
  const isTrapLocked = state.trapLockActive[state.currentPlayer]
  const isDamageCostRaised = state.damageCostActive[state.currentPlayer]
  const usableSelectedPiece =
    selectedPiece === 'NORMAL' || currentDeck.includes(selectedPiece as SpecialPiece)
      ? canUsePiece(state, state.currentPlayer, selectedPiece)
        ? selectedPiece
        : 'NORMAL'
      : 'NORMAL'
  const isGameOver = Boolean(state.winner)
  const isCpuTurn =
    mode === 'cpu' && state.currentPlayer === cpuPlayer && !isGameOver && !pendingBarrier && !pendingTrap
  const activeInfo = pieceInfo[usableSelectedPiece]
  const message =
    usableSelectedPiece === 'LANCE' && !isCpuTurn && !isGameOver
      ? reverseTargets.size > 0
        ? 'リバース対象を選んでください。返マークの相手石を1つ直接返せます。'
        : 'リバースで返せる相手石がありません。'
      : usableSelectedPiece === 'DROP' && !isCpuTurn && !isGameOver
      ? dropTargets.size > 0
        ? 'ドロップを使用すると、空いているランダムなマスに自分の石を置きます。'
        : 'ドロップで置ける空きマスがありません。'
      : pendingBarrier
      ? `追加でアンカーを付与する自分の石を選んでください (${pendingBarrier.selected.length}/2)。完了ボタンでターン終了。`
      : pendingTrap
      ? `追加で罠を付与する自分の石を選んでください (${pendingTrap.selected.length}/2)。完了ボタンでターン終了。`
      : getStatusMessage(state, legalMoves.length)

  useEffect(() => {
    if (!isCpuTurn || legalMoves.length === 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setState((current) => {
        const currentMoves = getLegalMovesForState(current, current.currentPlayer)
        const choice = chooseCpuMove(current, currentMoves, cpuDeck)
        if (choice.piece === 'LANCE') {
          const target = chooseReverseTargetForCpu(current)
          return target ? applyDirectReverseAction(current, target) : applyPlaceAction(current, 'NORMAL', choice.move)
        }
        if (choice.piece === 'DROP') {
          return applyDirectDropAction(current)
        }
        return applyPlaceAction(current, choice.piece, choice.move)
      })
    }, 650)

    return () => window.clearTimeout(timer)
  }, [cpuDeck, isCpuTurn, legalMoves.length])

  useEffect(() => {
    if (state.visualEffects.length === 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, visualEffects: [] }))
    }, 900)

    return () => window.clearTimeout(timer)
  }, [state.visualEffects.length])

  const playMove = useCallback(
    (move: MoveResult) => {
      if (
        isGameOver ||
        isCpuTurn ||
        pendingBarrier ||
        pendingTrap ||
        usableSelectedPiece === 'LANCE' ||
        usableSelectedPiece === 'DROP'
      ) {
        return
      }

      const entersSilenceZone =
        usableSelectedPiece !== 'NORMAL' && isSilenceZoneForPlayer(state, move, state.currentPlayer)

      if (usableSelectedPiece === 'BARRIER' && !entersSilenceZone) {
        const started = applyBarrierPlacementStart(state, move)
        setState(started.next)
        setPendingBarrier(started.pending)
        return
      }

      if (usableSelectedPiece === 'TRAP' && !entersSilenceZone) {
        const started = applyTrapPlacementStart(state, move)
        setState(started.next)
        setPendingTrap(started.pending)
        return
      }

      setState(applyPlaceAction(state, usableSelectedPiece, move))
      setSelectedPiece('NORMAL')
      setHoveredMoveKey(null)
    },
    [isCpuTurn, isGameOver, pendingBarrier, pendingTrap, state, usableSelectedPiece],
  )

  const handleDropUse = useCallback(() => {
    if (isGameOver || isCpuTurn || usableSelectedPiece !== 'DROP') {
      return
    }

    setState(applyDirectDropAction(state))
    setSelectedPiece('NORMAL')
    setHoveredMoveKey(null)
  }, [isCpuTurn, isGameOver, state, usableSelectedPiece])

  const handleReverseTarget = useCallback(
    (target: Coord) => {
      if (isGameOver || isCpuTurn || usableSelectedPiece !== 'LANCE') {
        return
      }

      setState(applyDirectReverseAction(state, target))
      setSelectedPiece('NORMAL')
      setHoveredMoveKey(null)
    },
    [isCpuTurn, isGameOver, state, usableSelectedPiece],
  )

  const handleBarrierTarget = useCallback(
    (target: Coord) => {
      if (!pendingBarrier) {
        return
      }

      const selectedKey = `${target.x}-${target.y}`
      const alreadySelected = pendingBarrier.selected.some(
        (coord) => `${coord.x}-${coord.y}` === selectedKey,
      )

      if (alreadySelected) {
        setPendingBarrier({
          ...pendingBarrier,
          selected: pendingBarrier.selected.filter((coord) => `${coord.x}-${coord.y}` !== selectedKey),
        })
        return
      }

      if (pendingBarrier.selected.length >= 2) {
        return
      }

      setPendingBarrier({
        ...pendingBarrier,
        selected: [...pendingBarrier.selected, target],
      })
    },
    [pendingBarrier],
  )

  const finishBarrier = useCallback(() => {
    if (!pendingBarrier) {
      return
    }

    setState(finishBarrierSelection(state, pendingBarrier))
    setPendingBarrier(null)
    setSelectedPiece('NORMAL')
    setHoveredMoveKey(null)
  }, [pendingBarrier, state])

  const handleTrapTarget = useCallback(
    (target: Coord) => {
      if (!pendingTrap) {
        return
      }

      const selectedKey = `${target.x}-${target.y}`
      const alreadySelected = pendingTrap.selected.some(
        (coord) => `${coord.x}-${coord.y}` === selectedKey,
      )

      if (alreadySelected) {
        setPendingTrap({
          ...pendingTrap,
          selected: pendingTrap.selected.filter((coord) => `${coord.x}-${coord.y}` !== selectedKey),
        })
        return
      }

      if (pendingTrap.selected.length >= 2) {
        return
      }

      setPendingTrap({
        ...pendingTrap,
        selected: [...pendingTrap.selected, target],
      })
    },
    [pendingTrap],
  )

  const finishTrap = useCallback(() => {
    if (!pendingTrap) {
      return
    }

    setState(finishTrapSelection(state, pendingTrap))
    setPendingTrap(null)
    setSelectedPiece('NORMAL')
    setHoveredMoveKey(null)
  }, [pendingTrap, state])

  function resetGame(nextMode = mode, nextRules = rules) {
    const limitedDecks = limitDecks(decks, nextRules.maxDeckSize)

    setRules(nextRules)
    setDecks(limitedDecks)
    setState(createInitialState(nextRules))
    setSelectedPiece('NORMAL')
    setPendingBarrier(null)
    setPendingTrap(null)
    setHoveredMoveKey(null)
    setMode(nextMode)
  }

  function startGame(nextMode: GameMode, nextRules = rules) {
    resetGame(nextMode, nextRules)
    setPage('game')
  }

  function openAbilitySetup(nextRules: GameRules) {
    setPendingRules(nextRules)
    setPage('ability-setup')
  }

  function toggleDeckPiece(player: Player, piece: SpecialPiece) {
    setDecks((current) => {
      const selected = current[player]

      if (selected.includes(piece)) {
        return {
          ...current,
          [player]: selected.filter((item) => item !== piece),
        }
      }

      if (selected.length >= deckBuilderLimit) {
        return current
      }

      return {
        ...current,
        [player]: [...selected, piece],
      }
    })
  }

  function goToMenu() {
    if (page === 'game' && !window.confirm('現在の対戦を終了してメニューに戻りますか？')) {
      return
    }

    setDecks(defaultDecks)
    setSelectedPiece('NORMAL')
    setPendingBarrier(null)
    setPendingTrap(null)
    setHoveredMoveKey(null)
    setPage('menu')
  }

  return (
    <main className="app-shell">
      <header className="top-app-bar">
        <div className="brand-group">
          <button className="icon-button" type="button" aria-label="Menu">
            <Menu aria-hidden="true" />
          </button>
          <div className="brand-mark">SR</div>
          <strong>Special Reversi</strong>
        </div>

        <div className="turn-strip">
          {page === 'game' ? (
            <>
              <span className={`mini-disc ${state.currentPlayer.toLowerCase()}`} />
              <div>
                <strong>Turn {state.turn}</strong>
                <span>{isGameOver ? 'Game ended' : `${formatPlayer(state.currentPlayer)} to move`}</span>
              </div>
            </>
          ) : (
            <div>
              <strong>
                {page === 'menu'
                  ? 'Main Menu'
                  : page === 'local-settings'
                  ? 'Match Settings'
                  : 'Ability Setup'}
              </strong>
              <span>
                {page === 'menu'
                  ? 'Select a match type'
                  : page === 'local-settings'
                  ? 'Choose match rules'
                  : 'Build ability decks before the match'}
              </span>
            </div>
          )}
        </div>

        <div className="top-actions">
          <button type="button" onClick={goToMenu}>
            <Menu aria-hidden="true" />
            <span>Menu</span>
          </button>
          <button type="button" onClick={() => resetGame()} title="Undo is not available yet">
            <RotateCcw aria-hidden="true" />
            <span>Reset</span>
          </button>
          <button type="button" title="Help">
            <CircleHelp aria-hidden="true" />
            <span>Help</span>
          </button>
        </div>
      </header>

      {page === 'menu' ? (
        <MainMenu
          mode={mode}
          onSelectMode={setMode}
          onOpenLocalSettings={() => setPage('local-settings')}
        />
      ) : page === 'local-settings' ? (
        <LocalMatchSettings
          mode={mode}
          defaultRules={defaultGameRules}
          customRules={customRules}
          onChangeCustomRules={setCustomRules}
          onStartDefault={() => openAbilitySetup(defaultGameRules)}
          onStartCustom={() => openAbilitySetup(customRules)}
          onBackToMenu={goToMenu}
        />
      ) : page === 'ability-setup' ? (
        <AbilitySetup
          mode={mode}
          rules={pendingRules}
          decks={decks}
          onToggleDeckPiece={toggleDeckPiece}
          onBackToRules={() => setPage('local-settings')}
          onStartGame={() => startGame(mode, pendingRules)}
        />
      ) : (
      <section className="game-layout" aria-label="Special Reversi board">
        <aside className="left-rail">
          <PlayerCard
            player="BLACK"
            score={score.BLACK}
            sp={state.specialPoints.BLACK}
            currentPlayer={state.currentPlayer}
          />
          <PlayerCard
            player="WHITE"
            score={score.WHITE}
            sp={state.specialPoints.WHITE}
            currentPlayer={state.currentPlayer}
          />

          <section className="rail-card">
            <h2>Active Effects</h2>
            <EffectSummary state={state} />
          </section>

          <section className="rail-card event-log">
            <h2>Captured History</h2>
            {state.events.length === 0 ? (
              <p className="muted">No actions yet.</p>
            ) : (
              state.events.map((event) => (
                <p key={`${event.turn}-${event.player}-${event.at.x}-${event.at.y}`}>
                  <span>{event.turn}</span>
                  {formatPlayer(event.player)} {pieceInfo[event.piece].label} at{' '}
                  {coordLabel(event.at)} · {event.captured}
                </p>
              ))
            )}
          </section>

          <button type="button" className="surrender-button" onClick={() => resetGame()}>
            <Flag aria-hidden="true" />
            <span>New Game</span>
          </button>
        </aside>

        <section className="board-pane">
          <div className="board-frame">
            <div className="column-labels" aria-hidden="true">
              {columns.map((column) => (
                <span key={column}>{column}</span>
              ))}
            </div>
            <div className="board-row">
              <div className="row-labels" aria-hidden="true">
                {rows.map((row) => (
                  <span key={row}>{row}</span>
                ))}
              </div>
              <div className="board">
                {hoveredMove && hoveredComboOrigins.length > 0 ? (
                  <svg className="combo-preview-lines" viewBox="0 0 100 100" aria-hidden="true">
                    {hoveredComboOrigins.map((origin) => (
                      <line
                        key={`${origin.x}-${origin.y}`}
                        x1={coordToPercent(hoveredMove.x)}
                        y1={coordToPercent(hoveredMove.y)}
                        x2={coordToPercent(origin.x)}
                        y2={coordToPercent(origin.y)}
                      />
                    ))}
                  </svg>
                ) : null}
                {state.board.map((cell) => {
                  const moveKey = `${cell.coord.x}-${cell.coord.y}`
                  const move = moveMap.get(moveKey)
                  const reverseTarget = reverseTargets.get(moveKey)
                  const barrierTarget = barrierTargetMap.get(moveKey)
                  const trapTarget = trapTargetMap.get(moveKey)
                  const placementBlock = placementBlockMap.get(moveKey)
                  const damageCell = damageCellMap.get(moveKey)
                  const isSilenceZone = silenceZoneKeys.has(moveKey)
                  const silenceZoneEdges = silenceZoneEdgeMap.get(moveKey) ?? ''
                  const isLegal = Boolean(
                    move &&
                      !isGameOver &&
                      !isCpuTurn &&
                      !pendingBarrier &&
                      !pendingTrap &&
                      usableSelectedPiece !== 'LANCE' &&
                      usableSelectedPiece !== 'DROP',
                  )
                  const isReverseTarget = Boolean(
                    usableSelectedPiece === 'LANCE' && !isGameOver && !isCpuTurn && reverseTarget,
                  )
                  const isBarrierTarget = Boolean(pendingBarrier && barrierTarget)
                  const isBarrierSelected = Boolean(
                    pendingBarrier?.selected.some(
                      (coord) => coord.x === cell.coord.x && coord.y === cell.coord.y,
                    ),
                  )
                  const isTrapTarget = Boolean(pendingTrap && trapTarget)
                  const isTrapSelected = Boolean(
                    pendingTrap?.selected.some(
                      (coord) => coord.x === cell.coord.x && coord.y === cell.coord.y,
                    ),
                  )
                  const isDamageSilenced = Boolean(damageCell && isDamageCellSilenced(damageCell, state.turn))
                  const selected = cell.disc?.piece !== 'NORMAL'
                  const effect = visualEffectMap.get(moveKey)
                  const hasComboPreview = isLegal && comboPreviewMap.has(moveKey)
                  const isComboOrigin = hoveredComboOriginKeys.has(moveKey)

                  return (
                    <button
                      type="button"
                      className={`cell ${isLegal ? 'is-legal' : ''} ${isComboOrigin ? 'is-combo-origin' : ''} ${isReverseTarget ? 'is-reverse-target' : ''} ${isBarrierTarget ? 'is-barrier-target' : ''} ${isBarrierSelected ? 'is-barrier-selected' : ''} ${isTrapTarget ? 'is-trap-target' : ''} ${isTrapSelected ? 'is-trap-selected' : ''} ${isSilenceZone ? 'is-silence-zone' : ''} ${silenceZoneEdges} ${placementBlock ? 'is-placement-blocked' : ''} ${damageCell ? `is-damage-cell damage-for-${damageCell.damageFor.toLowerCase()}` : ''} ${isDamageSilenced ? 'is-damage-silenced' : ''} ${selected ? 'has-special' : ''} ${effect ? `effect-${effect}` : ''}`}
                      key={moveKey}
                      onMouseEnter={() => {
                        if (hasComboPreview) {
                          setHoveredMoveKey(moveKey)
                        }
                      }}
                      onMouseLeave={() => {
                        if (hoveredMoveKey === moveKey) {
                          setHoveredMoveKey(null)
                        }
                      }}
                      onFocus={() => {
                        if (hasComboPreview) {
                          setHoveredMoveKey(moveKey)
                        }
                      }}
                      onBlur={() => {
                        if (hoveredMoveKey === moveKey) {
                          setHoveredMoveKey(null)
                        }
                      }}
                      onClick={() => {
                        if (trapTarget) {
                          handleTrapTarget(trapTarget)
                          return
                        }

                        if (barrierTarget) {
                          handleBarrierTarget(barrierTarget)
                          return
                        }

                        if (reverseTarget) {
                          handleReverseTarget(reverseTarget)
                          return
                        }

                        if (move) {
                          playMove(move)
                        }
                      }}
                      disabled={!isLegal && !isReverseTarget && !isBarrierTarget && !isTrapTarget}
                      aria-label={
                        isTrapTarget
                          ? `${coordLabel(cell.coord)}に罠を付与する`
                          : isBarrierTarget
                          ? `${coordLabel(cell.coord)}に追加アンカーを付与する`
                          : isReverseTarget
                          ? `${coordLabel(cell.coord)}の相手石をリバースで返す`
                          : isLegal
                          ? `${coordLabel(cell.coord)}に${activeInfo.label}を置く`
                          : damageCell
                          ? `${coordLabel(cell.coord)}は${formatPlayer(damageCell.damageFor)}用ダメージマス`
                          : coordLabel(cell.coord)
                      }
                    >
                      {isSilenceZone ? <span className="silence-zone-ring" aria-hidden="true" /> : null}
                      {placementBlock ? <span className="block-badge" aria-hidden="true">禁</span> : null}
                      {cell.disc ? (
                        <DiscView disc={cell.disc} />
                      ) : isLegal ? (
                        <span className="legal-ring" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div
            className={`piece-dock ${isTrapLocked ? 'is-trap-locked' : ''} ${
              isDamageCostRaised ? 'is-damage-cost-raised' : ''
            }`}
            aria-label="Piece selection"
          >
            {(['NORMAL', ...currentDeck] as PieceType[]).map((piece) => {
              const cooldown =
                piece === 'NORMAL' ? 0 : getCooldownRemaining(state, state.currentPlayer, piece)
              const disabled = !canUsePiece(state, state.currentPlayer, piece) || isCpuTurn || isGameOver
              const showsTrapLock = isTrapLocked && piece !== 'NORMAL'
              const showsDamageCost = isDamageCostRaised && piece !== 'NORMAL' && !showsTrapLock
              return (
                <button
                  type="button"
                  className={`piece-button ${pieceInfo[piece].tone} ${usableSelectedPiece === piece ? 'is-selected' : ''} ${showsTrapLock ? 'is-trap-locked' : ''} ${showsDamageCost ? 'is-damage-cost-raised' : ''}`}
                  key={piece}
                  disabled={disabled}
                  title={pieceInfo[piece].hint}
                  onClick={() => {
                    setSelectedPiece(piece)
                    if (piece === 'DROP') {
                      handleDropUse()
                    }
                  }}
                >
                  <PieceIcon piece={piece} />
                  <span>{pieceInfo[piece].short}</span>
                  <small>
                    {piece === 'NORMAL'
                      ? 'Free'
                      : cooldown > 0
                      ? `CT${cooldown}`
                      : `SP${getEffectiveSpecialCost(state, state.currentPlayer, piece)}`}
                  </small>
                  {showsTrapLock ? (
                    <span className="trap-lock-overlay" aria-hidden="true">
                      <Link2 />
                    </span>
                  ) : null}
                  {showsDamageCost ? <span className="damage-cost-overlay" aria-hidden="true">+1</span> : null}
                </button>
              )
            })}
          </div>

          {pendingBarrier ? (
            <button type="button" className="finish-barrier-button" onClick={finishBarrier}>
              アンカー選択を完了 ({pendingBarrier.selected.length}/2)
            </button>
          ) : null}

          {pendingTrap ? (
            <button type="button" className="finish-trap-button" onClick={finishTrap}>
              罠選択を完了 ({pendingTrap.selected.length}/2)
            </button>
          ) : null}

          <p className="board-hint">{message}</p>
        </section>

        <aside className="right-rail">
          <section className="rail-card">
            <h2>Deck Abilities</h2>
            <AbilityList pieces={currentDeck} />
          </section>

          <section className="rail-card selected-card">
            <h2>Selected Piece</h2>
            <div className={`selected-piece ${activeInfo.tone}`}>
              <PieceIcon piece={usableSelectedPiece} />
              <div>
                <strong>{activeInfo.label}</strong>
                <span>
                  Cost {getEffectiveSpecialCost(state, state.currentPlayer, usableSelectedPiece)}
                  {usableSelectedPiece !== 'NORMAL' && state.rules.cooldownsEnabled
                    ? ` / CT ${getCooldownRemaining(state, state.currentPlayer, usableSelectedPiece)}`
                    : ''}
                </span>
              </div>
            </div>
            <p>{activeInfo.hint}</p>
            <AbilityPreview piece={usableSelectedPiece} />
          </section>

          <section className="rail-card game-guide">
            <h2>Game Guide</h2>
            <ol>
              <li>黒が先手。黄色いリングの合法手だけに置けます。</li>
              <li>特殊駒も通常駒と同じく、相手を挟める場所にだけ置けます。</li>
              <li>置いた後に通常反転を行い、その後で特殊能力が1回だけ発動します。</li>
              <li>常在型の能力は、その駒が自分の色で盤上に残っている限り自分のターン終了時に発動します。</li>
              <li>
                各プレイヤーはSP0から開始。自分のターンが来るたびにSPを1回復し、所持上限は
                {state.rules.maxSpecialPoints}です。
              </li>
              <li>
                {state.rules.cooldownsEnabled
                  ? '能力は使用後、コスト値+1ターンのクールタイムになります。'
                  : 'このルールでは能力のクールタイムはありません。'}
              </li>
              <li>両者が打てなくなったら終局し、石数が多い方の勝ちです。</li>
            </ol>
          </section>

        </aside>
      </section>
      )}
    </main>
  )
}

function MainMenu({
  mode,
  onSelectMode,
  onOpenLocalSettings,
}: {
  mode: GameMode
  onSelectMode: (mode: GameMode) => void
  onOpenLocalSettings: () => void
}) {
  return (
    <section className="main-menu-page" aria-label="Main menu">
      <div className="main-menu-header">
        <div>
          <h1>Special Reversi</h1>
          <p>デッキを組み、能力駒を使って盤面を制圧します。</p>
        </div>
      </div>

      <div className="menu-mode-grid">
        <button
          type="button"
          className={`menu-mode-card ${mode === 'local' ? 'is-selected' : ''}`}
          onClick={() => {
            onSelectMode('local')
            onOpenLocalSettings()
          }}
        >
          <span className="menu-mode-icon local">
            <Users aria-hidden="true" />
          </span>
          <strong>ローカル対戦</strong>
          <small>1台の端末で2人対戦</small>
          <span>Open Match Settings</span>
        </button>

        <button
          type="button"
          className={`menu-mode-card ${mode === 'cpu' ? 'is-selected' : ''}`}
          onClick={() => {
            onSelectMode('cpu')
            onOpenLocalSettings()
          }}
        >
          <span className="menu-mode-icon cpu">
            <Bot aria-hidden="true" />
          </span>
          <strong>ボット対戦</strong>
          <small>CPU相手に能力デッキを試す</small>
          <span>Open Match Settings</span>
        </button>

        <button type="button" className="menu-mode-card is-disabled" disabled>
          <span className="menu-mode-icon online">
            <Globe2 aria-hidden="true" />
          </span>
          <strong>ルーム対戦</strong>
          <small>オンライン対戦用の入口</small>
          <span>Coming Soon</span>
        </button>
      </div>

      <section className="menu-status-panel" aria-label="Match setup">
        <div>
          <strong>Current Deck Rule</strong>
          <span>通常ルールは最大3つ、カスタムルールでは上限を変更可能</span>
        </div>
        <div>
          <strong>SP Rule</strong>
          <span>初期SP0、ターン開始時に1回復、通常上限5</span>
        </div>
        <div>
          <strong>Room Match Ready</strong>
          <span>将来のルームID、マッチング、観戦導線を追加できる構成</span>
        </div>
      </section>
    </section>
  )
}

function LocalMatchSettings({
  mode,
  defaultRules,
  customRules,
  onChangeCustomRules,
  onStartDefault,
  onStartCustom,
  onBackToMenu,
}: {
  mode: GameMode
  defaultRules: GameRules
  customRules: GameRules
  onChangeCustomRules: (rules: GameRules) => void
  onStartDefault: () => void
  onStartCustom: () => void
  onBackToMenu: () => void
}) {
  const updateCustomRule = (patch: Partial<GameRules>) => {
    onChangeCustomRules({ ...customRules, ...patch })
  }

  return (
    <section className="rules-page" aria-label="Local match settings">
      <div className="rules-header">
        <div>
          <h1>{mode === 'local' ? 'ローカル対戦設定' : 'ボット対戦設定'}</h1>
          <p>標準ルールかカスタムルールを選び、次の画面で能力構成を決めます。</p>
        </div>
        <button type="button" onClick={onBackToMenu}>
          メニューに戻る
        </button>
      </div>

      <div className="rules-grid">
        <section className="rule-card">
          <span className="rule-card-icon">
            <Shield aria-hidden="true" />
          </span>
          <h2>デフォルトルール</h2>
          <p>現在の基本バランスで対戦します。デッキは3つ、SP上限は5、クールタイムありです。</p>
          <dl className="rule-summary">
            <div>
              <dt>最大SP</dt>
              <dd>{defaultRules.maxSpecialPoints}</dd>
            </div>
            <div>
              <dt>能力選択数</dt>
              <dd>{defaultRules.maxDeckSize}</dd>
            </div>
            <div>
              <dt>クールタイム</dt>
              <dd>{defaultRules.cooldownsEnabled ? 'あり' : 'なし'}</dd>
            </div>
          </dl>
          <button type="button" className="start-game-button" onClick={onStartDefault}>
            ゲーム開始
          </button>
        </section>

        <section className="rule-card custom-rule-card">
          <span className="rule-card-icon custom">
            <Settings aria-hidden="true" />
          </span>
          <h2>カスタムルール</h2>
          <p>オリジナルの条件でローカル対戦を開始します。</p>

          <label className="rule-control">
            <span>最大所持SP</span>
            <input
              type="number"
              min={3}
              max={20}
              value={customRules.maxSpecialPoints}
              onChange={(event) =>
                updateCustomRule({
                  maxSpecialPoints: clampRuleValue(Number(event.target.value), 3, 20),
                })
              }
            />
          </label>

          <label className="rule-control">
            <span>能力選択数上限</span>
            <input
              type="number"
              min={1}
              max={specialPieces.length}
              value={customRules.maxDeckSize}
              onChange={(event) =>
                updateCustomRule({
                  maxDeckSize: clampRuleValue(Number(event.target.value), 1, specialPieces.length),
                })
              }
            />
          </label>

          <label className="rule-toggle">
            <input
              type="checkbox"
              checked={!customRules.cooldownsEnabled}
              onChange={(event) => updateCustomRule({ cooldownsEnabled: !event.target.checked })}
            />
            <span>
              <strong>クールタイムなし</strong>
              <small>能力使用後すぐに再使用できるルールにします。</small>
            </span>
          </label>

          <button type="button" className="start-game-button" onClick={onStartCustom}>
            ゲーム開始
          </button>
        </section>
      </div>
    </section>
  )
}

function getStatusMessage(state: MatchState, legalMoveCount: number) {
  if (state.winner === 'DRAW') {
    return 'Game ended in a draw.'
  }

  if (state.winner) {
    return `${formatPlayer(state.winner)} wins by disc count.`
  }

  if (state.passesInRow === 1) {
    return 'Opponent had no legal move and passed automatically.'
  }

  if (state.trapLockActive[state.currentPlayer]) {
    return `${formatPlayer(state.currentPlayer)} is trapped: no natural SP recovery and abilities are disabled this turn.`
  }

  if (state.damageCostActive[state.currentPlayer]) {
    return `${formatPlayer(state.currentPlayer)} has damage pressure: ability costs are +1 this turn.`
  }

  return `${formatPlayer(state.currentPlayer)} has ${legalMoveCount} legal moves.`
}

function AbilitySetup({
  mode,
  rules,
  decks,
  onToggleDeckPiece,
  onBackToRules,
  onStartGame,
}: {
  mode: GameMode
  rules: GameRules
  decks: Record<Player, SpecialPiece[]>
  onToggleDeckPiece: (player: Player, piece: SpecialPiece) => void
  onBackToRules: () => void
  onStartGame: () => void
}) {
  return (
    <section className="rules-page" aria-label="Ability setup">
      <div className="rules-header">
        <div>
          <h1>能力構成</h1>
          <p>
            {mode === 'local' ? 'ローカル対戦' : 'ボット対戦'}で使う能力駒を選びます。
            このルールでは最大{rules.maxDeckSize}つまで選択できます。
          </p>
        </div>
        <div className="rules-header-actions">
          <button type="button" className="secondary-button" onClick={onBackToRules}>
            ルールに戻る
          </button>
          <button type="button" className="start-game-button" onClick={onStartGame}>
            対戦開始
          </button>
        </div>
      </div>

      <section className="menu-status-panel setup-rule-summary" aria-label="Selected rules">
        <div>
          <strong>最大SP</strong>
          <span>{rules.maxSpecialPoints}</span>
        </div>
        <div>
          <strong>能力選択数</strong>
          <span>{rules.maxDeckSize}</span>
        </div>
        <div>
          <strong>クールタイム</strong>
          <span>{rules.cooldownsEnabled ? 'あり' : 'なし'}</span>
        </div>
      </section>

      <DeckBuilder
        decks={decks}
        maxDeckSize={rules.maxDeckSize}
        onToggle={onToggleDeckPiece}
      />
    </section>
  )
}

function DeckBuilder({
  decks,
  maxDeckSize,
  onToggle,
}: {
  decks: Record<Player, SpecialPiece[]>
  maxDeckSize: number
  onToggle: (player: Player, piece: SpecialPiece) => void
}) {
  return (
    <section className="deck-page setup-deck-page" aria-label="Ability deck selection">
      <div className="deck-header">
        <div>
          <h1>能力選択</h1>
          <p>ゲーム開始前に、各プレイヤーの能力駒を最大{maxDeckSize}つまで選択します。</p>
        </div>
      </div>

      <div className="deck-columns">
        {(['BLACK', 'WHITE'] as Player[]).map((player) => {
          const visibleDeck = decks[player].slice(0, maxDeckSize)

          return (
            <section className="deck-panel" key={player}>
              <div className="deck-panel-header">
                <span className={`mini-disc ${player.toLowerCase()}`} />
                <div>
                  <h2>{player === 'BLACK' ? 'Player 1 Deck' : 'Player 2 Deck'}</h2>
                  <p>{visibleDeck.length}/{maxDeckSize}</p>
                </div>
              </div>

              <div
                className="deck-slots"
                style={{ gridTemplateColumns: `repeat(${maxDeckSize}, minmax(0, 1fr))` }}
                aria-label={`${formatPlayer(player)} selected deck`}
              >
                {Array.from({ length: maxDeckSize }).map((_, index) => {
                  const piece = visibleDeck[index]
                  return (
                    <span className={`deck-slot ${piece ? pieceInfo[piece].tone : ''}`} key={`${player}-${index}`}>
                      {piece ? <PieceIcon piece={piece} /> : null}
                    </span>
                  )
                })}
              </div>

              <div className="deck-card-grid">
                {specialPieces.map((piece) => {
                  const selected = visibleDeck.includes(piece)
                  const locked = !selected && visibleDeck.length >= maxDeckSize

                  return (
                    <button
                      type="button"
                      className={`deck-card ${pieceInfo[piece].tone} ${selected ? 'is-selected' : ''} ${
                        locked ? 'is-locked' : ''
                      }`}
                      key={`${player}-${piece}`}
                      aria-disabled={locked}
                      onClick={() => {
                        if (!locked) {
                          onToggle(player, piece)
                        }
                      }}
                    >
                      <span className={`ability-icon ${pieceInfo[piece].tone}`}>
                        <PieceIcon piece={piece} />
                      </span>
                      <strong>{pieceInfo[piece].label}</strong>
                      <small>SP{specialCost[piece]}</small>
                      <span className="deck-card-summary">{pieceInfo[piece].summary}</span>
                      <span className="deck-card-detail" role="tooltip">
                        {pieceInfo[piece].hint}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}

function PlayerCard({
  player,
  score,
  sp,
  currentPlayer,
}: {
  player: Player
  score: number
  sp: number
  currentPlayer: Player
}) {
  return (
    <section className={`player-card ${currentPlayer === player ? 'is-current' : ''}`}>
      <div className="avatar">{player === 'BLACK' ? 'P1' : 'P2'}</div>
      <div>
        <h2>{player === 'BLACK' ? 'Player 1' : 'Player 2'}</h2>
        <p>ELO {player === 'BLACK' ? '1247' : '1189'}</p>
      </div>
      <span className={`mini-disc ${player.toLowerCase()}`} />
      <strong>{score}</strong>
      <div className="reserve-row">
        <span className="sp-value">SP {sp}</span>
      </div>
      {currentPlayer === player ? <em>Your turn</em> : null}
    </section>
  )
}

function DiscView({ disc }: { disc: Disc }) {
  const isInactiveCharge =
    disc.piece === 'CHARGE' && !disc.statuses.some((status) => status.type === 'CHARGE')
  const isSilenced = disc.statuses.some((status) => status.type === 'SILENCE')
  const hasTrap = disc.statuses.some((status) => status.type === 'TRAP')
  const hasGuard = disc.statuses.some((status) => status.type === 'GUARD' || status.type === 'WARD')

  return (
    <span
      className={`disc ${disc.owner.toLowerCase()} ${pieceInfo[disc.piece].tone} ${
        isInactiveCharge ? 'inactive-charge' : ''
      } ${isSilenced ? 'is-silenced' : ''}`}
    >
      {disc.piece !== 'NORMAL' ? <PieceIcon piece={disc.piece} /> : null}
      {hasTrap ? (
        <span className="trap-status-icon" aria-hidden="true">
          <TriangleAlert />
        </span>
      ) : null}
      {hasGuard ? (
        <span className="guard-status-icon" aria-hidden="true">
          <Shield />
        </span>
      ) : null}
      {disc.statuses.some((status) => status.type === 'GUARD') ? <i className="guard-badge" /> : null}
      {disc.statuses.some((status) => status.type === 'WARD') ? <i className="ward-badge" /> : null}
      {disc.statuses.some((status) => status.type === 'SILENCE') ? <i className="silence-badge" /> : null}
      {hasTrap ? <i className="trap-badge" /> : null}
    </span>
  )
}

function PieceIcon({ piece }: { piece: PieceType }) {
  if (piece === 'LANCE') return <RotateCcw aria-hidden="true" />
  if (piece === 'BLAST') return <Sparkle aria-hidden="true" />
  if (piece === 'BARRIER') return <Anchor aria-hidden="true" />
  if (piece === 'SEAL') return <Ban aria-hidden="true" />
  if (piece === 'DROP') return <CirclePlus aria-hidden="true" />
  if (piece === 'CHARGE') return <Gauge aria-hidden="true" />
  if (piece === 'DAMAGE') return <Flame aria-hidden="true" />
  if (piece === 'SILENCE') return <VolumeX aria-hidden="true" />
  if (piece === 'TRAP') return <TriangleAlert aria-hidden="true" />
  if (piece === 'GUARDIAN') return <Shield aria-hidden="true" />
  if (piece === 'MINEFIELD') return <Bomb aria-hidden="true" />
  if (piece === 'SNARE') return <Network aria-hidden="true" />
  return <span className="normal-dot" aria-hidden="true" />
}

function AbilityList({ pieces = specialPieces }: { pieces?: SpecialPiece[] }) {
  return (
    <div className="ability-list">
      {pieces.map((piece) => (
        <div key={piece}>
          <span className={`ability-icon ${pieceInfo[piece].tone}`}>
            <PieceIcon piece={piece} />
          </span>
          <p>
            <strong>{pieceInfo[piece].label}</strong>
            <span>{pieceInfo[piece].summary}</span>
          </p>
        </div>
      ))}
    </div>
  )
}

function AbilityPreview({ piece }: { piece: PieceType }) {
  const caption: Record<PieceType, string> = {
    NORMAL: '通常駒: 挟んだ相手駒を自分の色に返す',
    LANCE: 'リバース: 盤上の相手石を1枚選んで直接返す',
    BLAST: 'ブラスト: 周囲8マスの隣接相手駒をすべて返す',
    BARRIER: 'アンカー: 置いた石と選んだ自分の石に持続バリア',
    SEAL: 'シール: 周囲の空きマスを相手だけ次ターンまで封鎖',
    DROP: 'ドロップ: ランダムな空きマスに自分の石を置く',
    CHARGE: 'チャージ: 発動時点でその石を持つプレイヤーのSPを1回復',
    DAMAGE: 'ダメージ: 相手が置くと次ターンの能力コスト+1',
    SILENCE: 'サイレンス: 円形範囲20マスの相手能力・盤面効果を封印',
    TRAP: 'トラップ: 返した相手の次ターンのSP自然回復と能力使用を封じる',
    GUARDIAN: 'ガーディアン: 存在中、自ターン終了時に自分の石2つへバリア',
    MINEFIELD: 'マイン: 存在中、自ターン終了時に空きマス1つをダメージ化',
    SNARE: 'スネア: 存在中、自ターン終了時に通常の自分石1つへ罠',
  }

  return (
    <figure className={`ability-preview ${pieceInfo[piece].tone}`}>
      <div className="preview-board" aria-hidden="true">
        {getPreviewCells(piece).map((cell, index) => (
          <span className={cell.className} key={`${piece}-${index}`}>
            {cell.icon ? <PieceIcon piece={cell.icon} /> : null}
          </span>
        ))}
      </div>
      <figcaption>{caption[piece]}</figcaption>
    </figure>
  )
}

function getPreviewCells(piece: PieceType) {
  const empty: PreviewCell[] = Array.from({ length: 25 }, () => ({ className: 'preview-cell' }))
  const set = (index: number, className: string, icon?: PieceType) => {
    empty[index] = { className: `preview-cell ${className}`, icon }
  }

  if (piece === 'NORMAL') {
    set(11, 'preview-disc black')
    set(12, 'preview-disc white preview-flip')
    set(13, 'preview-disc black preview-new')
    set(17, 'preview-arrow')
    return empty
  }

  if (piece === 'LANCE') {
    set(6, 'preview-disc white preview-target')
    set(12, 'preview-disc black preview-new', 'LANCE')
    set(18, 'preview-disc white preview-extra')
    set(22, 'preview-arrow')
    return empty
  }

  if (piece === 'BLAST') {
    set(12, 'preview-disc black preview-new', 'BLAST')
    set(6, 'preview-disc white preview-extra')
    set(7, 'preview-disc white preview-extra')
    set(8, 'preview-disc white preview-extra')
    set(11, 'preview-disc white preview-extra')
    set(13, 'preview-disc white preview-extra')
    set(16, 'preview-disc white preview-extra')
    set(17, 'preview-disc white preview-extra')
    set(18, 'preview-disc white preview-extra')
    return empty
  }

  if (piece === 'SEAL') {
    set(6, 'preview-blocked')
    set(7, 'preview-blocked')
    set(8, 'preview-blocked')
    set(11, 'preview-blocked')
    set(12, 'preview-disc black preview-new', 'SEAL')
    set(13, 'preview-blocked')
    set(16, 'preview-blocked')
    set(17, 'preview-blocked')
    set(18, 'preview-blocked')
    return empty
  }

  if (piece === 'DROP') {
    set(6, 'preview-random')
    set(12, 'preview-disc black preview-new', 'DROP')
    set(18, 'preview-random')
    set(22, 'preview-arrow')
    return empty
  }

  if (piece === 'CHARGE') {
    set(7, 'preview-plus')
    set(12, 'preview-disc black preview-new', 'CHARGE')
    set(17, 'preview-arrow')
    return empty
  }

  if (piece === 'DAMAGE') {
    set(6, 'preview-damage')
    set(7, 'preview-damage')
    set(8, 'preview-damage')
    set(11, 'preview-damage')
    set(12, 'preview-disc black preview-new', 'DAMAGE')
    set(13, 'preview-damage')
    set(16, 'preview-damage')
    set(17, 'preview-damage')
    set(18, 'preview-damage')
    return empty
  }

  if (piece === 'SILENCE') {
    set(6, 'preview-silence')
    set(7, 'preview-silence')
    set(8, 'preview-silence')
    set(11, 'preview-silence')
    set(12, 'preview-disc black preview-new', 'SILENCE')
    set(13, 'preview-silence')
    set(16, 'preview-silence')
    set(17, 'preview-silence')
    set(18, 'preview-silence')
    return empty
  }

  if (piece === 'TRAP') {
    set(7, 'preview-disc black preview-trap')
    set(12, 'preview-disc black preview-new', 'TRAP')
    set(17, 'preview-disc black preview-trap')
    set(22, 'preview-arrow')
    return empty
  }

  if (piece === 'GUARDIAN') {
    set(6, 'preview-disc black preview-ward')
    set(12, 'preview-disc black preview-new preview-aura', 'GUARDIAN')
    set(13, 'preview-disc black preview-ward')
    set(18, 'preview-disc black preview-ward')
    set(22, 'preview-arrow')
    return empty
  }

  if (piece === 'MINEFIELD') {
    set(6, 'preview-damage')
    set(12, 'preview-disc black preview-new preview-aura', 'MINEFIELD')
    set(16, 'preview-damage')
    set(18, 'preview-damage')
    set(22, 'preview-arrow')
    return empty
  }

  if (piece === 'SNARE') {
    set(6, 'preview-disc black preview-trap')
    set(12, 'preview-disc black preview-new preview-aura', 'SNARE')
    set(16, 'preview-disc black preview-trap')
    set(18, 'preview-disc black preview-trap')
    set(22, 'preview-arrow')
    return empty
  }

  set(10, 'preview-disc black preview-ward')
  set(12, 'preview-disc black preview-new', 'BARRIER')
  set(18, 'preview-disc black preview-ward')
  return empty
}

function EffectSummary({ state }: { state: MatchState }) {
  const active = state.board.flatMap((cell) =>
    cell.disc?.statuses.map((status) => ({
      coord: cell.coord,
      owner: cell.disc!.owner,
      status,
    })) ?? [],
  )

  if (active.length === 0) {
    return <p className="muted">No protected discs.</p>
  }

  return (
    <div className="effect-list">
      {active.slice(0, 4).map((item) => (
        <p key={`${coordLabel(item.coord)}-${item.status.type}`}>
          <Shield aria-hidden="true" />
          <span>
            {item.status.type} at {coordLabel(item.coord)}
          </span>
        </p>
      ))}
    </div>
  )
}

export default App
