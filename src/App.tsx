import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Anchor,
  Ban,
  Bot,
  CircleHelp,
  CirclePlus,
  Crosshair,
  Flag,
  Flame,
  Gauge,
  Magnet,
  Menu,
  RotateCcw,
  Settings,
  Shield,
  Sparkle,
  Shuffle,
  Users,
  Zap,
} from 'lucide-react'
import './App.css'

type Player = 'BLACK' | 'WHITE'
type AppPage = 'deck' | 'game'
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
  | 'CROSS'
  | 'DIAGONAL'
  | 'DRAIN'
  | 'FORT'
  | 'BLOOM'
type SpecialPiece = Exclude<PieceType, 'NORMAL'>
type StatusType = 'GUARD' | 'WARD' | 'CHARGE'
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
  type: 'flip' | 'guard' | 'ward' | 'block' | 'place' | 'charge' | 'combo' | 'damage'
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

type MatchState = {
  board: Cell[]
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
}

type PlacementBlock = {
  coord: Coord
  blockedFor: Player
  expiresAtTurn: number
}

type DamageCell = {
  coord: Coord
  damageFor: Player
}

const boardSize = 8
const cpuPlayer: Player = 'WHITE'
const specialPieces: SpecialPiece[] = [
  'SEAL',
  'DROP',
  'BARRIER',
  'CHARGE',
  'DAMAGE',
  'DRAIN',
  'FORT',
  'BLOOM',
  'CROSS',
  'DIAGONAL',
  'BLAST',
  'LANCE',
]
const defaultDecks: Record<Player, SpecialPiece[]> = {
  BLACK: ['SEAL', 'DAMAGE', 'BARRIER'],
  WHITE: ['CHARGE', 'BLAST', 'LANCE'],
}
const maxDeckSize = 3
const directions: Direction[] = [-1, 0, 1].flatMap((dy) =>
  [-1, 0, 1]
    .filter((dx) => dx !== 0 || dy !== 0)
    .map((dx) => ({ dx, dy, key: `${dx}:${dy}` })),
)
const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const rows = ['1', '2', '3', '4', '5', '6', '7', '8']
const maxSpecialPoints = 5

const specialCost: Record<PieceType, number> = {
  NORMAL: 0,
  LANCE: 4,
  CHARGE: 2,
  BLAST: 3,
  BARRIER: 2,
  SEAL: 1,
  DROP: 1,
  DAMAGE: 2,
  CROSS: 2,
  DIAGONAL: 2,
  DRAIN: 1,
  FORT: 2,
  BLOOM: 2,
}

const comboPieces = new Set<PieceType>([
  'SEAL',
  'DROP',
  'BARRIER',
  'BLAST',
  'DAMAGE',
  'CROSS',
  'DIAGONAL',
  'DRAIN',
  'FORT',
  'BLOOM',
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
    summary: '相手が置くとSPを失うマスを作ります。',
    hint: '配置時、上下左右4マスの空きマスをダメージマスにします。相手がそのマスに石を置くと、相手のSPを2減少させます。コンボ時はランダムな空きマス1つをダメージマスにします。',
  },
  CROSS: {
    label: 'クロス',
    short: 'X',
    tone: 'cross',
    summary: '上下左右の射線で最初の相手石を返します。',
    hint: '配置した石から上下左右へ射線を伸ばし、各方向で最初に見つかった相手石を追加で返します。離れた石にも届く制圧型の能力です。',
  },
  DIAGONAL: {
    label: 'ダイア',
    short: 'I',
    tone: 'diagonal',
    summary: '斜めライン上の相手石をまとめて返します。',
    hint: '配置した石から斜め4方向へ伸びるライン上の相手石をすべて追加で返します。角へ伸びる長い斜線で大きな逆転を狙えます。',
  },
  DRAIN: {
    label: 'ドレイン',
    short: 'V',
    tone: 'drain',
    summary: '相手SPを最大2奪って自分のSPにします。',
    hint: '配置後、相手のSPを最大2減らし、減らした分だけ自分のSPを回復します。相手がSP0なら自分だけSPを1回復します。',
  },
  FORT: {
    label: 'フォート',
    short: 'F',
    tone: 'fort',
    summary: '周囲を守り、前後左右を危険地帯にします。',
    hint: '置いた石と周囲8マスの自分石にバリアを付与し、さらに上下左右の空きマスを相手用ダメージマスにします。拠点を作る能力です。',
  },
  BLOOM: {
    label: 'ブルーム',
    short: 'M',
    tone: 'bloom',
    summary: '周囲に自分の石を最大3つ増やします。',
    hint: '配置後、周囲8マスの空きマスから最大3つ選び、自分の通常石を追加配置します。追加された石からも連鎖反転が発生します。',
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

function createInitialState(): MatchState {
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
    CROSS: 0,
    DIAGONAL: 0,
    DRAIN: 0,
    FORT: 0,
    BLOOM: 0,
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

  return state.specialPoints[player] >= specialCost[piece]
}

function hasBlockingWard(disc: Disc, turn: number) {
  return disc.statuses.some(
    (status) => status.type === 'WARD' && status.expiresAtTurn !== undefined && turn <= status.expiresAtTurn,
  )
}

function tryFlip(board: Cell[], coord: Coord, attacker: Player, turn: number) {
  const disc = getCell(board, coord).disc

  if (!disc || disc.owner === attacker || isCorner(coord)) {
    return false
  }

  if (hasBlockingWard(disc, turn)) {
    return false
  }

  const guard = disc.statuses.find(
    (status) => status.type === 'GUARD' && (status.charges ?? 0) > 0,
  )

  if (guard) {
    guard.charges = 0
    disc.statuses = disc.statuses.filter(
      (status) => status.type !== 'GUARD' || (status.charges ?? 0) > 0,
    )
    return false
  }

  disc.owner = attacker
  for (const status of disc.statuses) {
    if (status.type === 'CHARGE') {
      status.resolveAtTurn = turn + 1
    }
  }
  disc.statuses = disc.statuses.filter((status) => status.type !== 'WARD')
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

function applyChainFlips(board: Cell[], player: Player, origins: Coord[], turn: number) {
  const flipped: Coord[] = []

  for (const origin of origins) {
    for (const target of findChainFlips(board, player, origin)) {
      if (tryFlip(board, target, player, turn)) {
        flipped.push(target)
      }
    }
  }

  return flipped
}

function applyPlaceAction(state: MatchState, piece: PieceType, move: MoveResult) {
  const next = cloneState(state)
  const player = next.currentPlayer
  const placedCell = getCell(next.board, move)
  placedCell.disc = createDisc(player, piece)
  const damage = applyDamageCellTrigger(next, move, player)

  const flippedByRule: Coord[] = []
  for (const line of move.captured) {
    for (const coord of line.coords) {
      if (tryFlip(next.board, coord, player, next.turn)) {
        flippedByRule.push(coord)
      }
    }
  }

  const special = resolveSpecialEffect(next, piece, move)
  const combo = resolveComboEffects(next, move)
  next.visualEffects = [...damage.effects, ...special.effects, ...combo.effects]

  if (piece !== 'NORMAL') {
    next.specialPoints[player] -= specialCost[piece]
  }

  next.events = [
    {
      turn: next.turn,
      player,
      piece,
      at: { x: move.x, y: move.y },
      captured: flippedByRule.length + special.count + combo.count,
      special: [damage.label, special.label, combo.label].filter(Boolean).join(' / '),
    },
    ...next.events,
  ].slice(0, 8)

  advanceTurn(next)
  return next
}

function applyBarrierPlacementStart(state: MatchState, move: MoveResult) {
  const next = cloneState(state)
  const player = next.currentPlayer
  const placedCell = getCell(next.board, move)
  placedCell.disc = createDisc(player, 'BARRIER')
  const damage = applyDamageCellTrigger(next, move, player)

  const flippedByRule: Coord[] = []
  for (const line of move.captured) {
    for (const coord of line.coords) {
      if (tryFlip(next.board, coord, player, next.turn)) {
        flippedByRule.push(coord)
      }
    }
  }

  const baseWarded = applyBaseBarrier(next, move)
  const combo = resolveComboEffects(next, move)
  next.specialPoints[player] -= specialCost.BARRIER
  next.visualEffects = [
    ...damage.effects,
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
      comboLabel: [damage.label, combo.label].filter(Boolean).join(' / '),
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

function applyDirectReverseAction(state: MatchState, target: Coord) {
  const next = cloneState(state)
  const player = next.currentPlayer
  const flipped = canSpecialFlip(next.board, target, player, next.turn)
    ? tryFlip(next.board, target, player, next.turn)
    : false
  const comboOrigins = flipped ? getComboOriginsFromFlank(next, [target]) : []
  const chainFlips = flipped ? applyChainFlips(next.board, player, [target], next.turn) : []
  const combo = flipped ? resolveComboEffectsFromOrigins(next, comboOrigins) : { count: 0, label: '', effects: [] }

  if (flipped) {
    next.specialPoints[player] -= specialCost.LANCE
  }

  next.visualEffects = [
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
          combo.label ? ` / ${combo.label}` : ''
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

  if (canPlace) {
    cell.disc = createDisc(player, 'DROP')
    damage = applyDamageCellTrigger(next, target, player)
    chainFlips.push(...applyChainFlips(next.board, player, [target], next.turn))
    next.specialPoints[player] -= specialCost.DROP
    next.visualEffects = [
      ...damage.effects,
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
    })),
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
    case 'CROSS':
      return resolveCross(state, move)
    case 'DIAGONAL':
      return resolveDiagonal(state, move)
    case 'DRAIN':
      return resolveDrain(state, move)
    case 'FORT':
      return resolveFort(state, move)
    case 'BLOOM':
      return resolveBloom(state, move)
    default:
      return { count: 0, label: 'standard flip', effects: [] }
  }
}

function resolveReverse(state: MatchState, move: MoveResult): SpecialResult {
  const player = state.currentPlayer
  const candidates = getReverseTargets(state)
    .filter((target) => !sameSquare(target, move))
    .sort((a, b) => positionWeights[b.y][b.x] - positionWeights[a.y][a.x])

  const target = candidates[0]

  if (!target) {
    return { count: 0, label: 'Reverse had no target', effects: [] }
  }

  const flipped = tryFlip(state.board, target, player, state.turn)
  const chainFlips = flipped ? applyChainFlips(state.board, player, [target], state.turn) : []

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

function resolveComboEffects(state: MatchState, move: MoveResult): SpecialResult {
  return resolveComboEffectsFromOrigins(state, getPlacementComboOrigins(state, move))
}

function getPlacementComboOrigins(state: MatchState, move: MoveResult) {
  return uniqueCoords(
    move.captured
      .map((line) => line.beyond)
      .filter((coord) => !sameSquare(coord, move))
      .filter((coord) => {
        const disc = getCell(state.board, coord).disc
        return Boolean(disc?.owner === state.currentPlayer && comboPieces.has(disc.piece))
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

function resolveComboEffectsFromOrigins(state: MatchState, origins: Coord[]): SpecialResult {
  const activeOrigins = uniqueCoords(origins).filter((coord) => {
    const disc = getCell(state.board, coord).disc
    return Boolean(disc?.owner === state.currentPlayer && comboPieces.has(disc.piece))
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
    return resolveDamageCombo(state)
  }

  if (piece === 'CROSS') {
    const result = resolveCross(state, move)
    return { ...result, label: `Cross +${result.count}` }
  }

  if (piece === 'DIAGONAL') {
    const result = resolveDiagonal(state, move)
    return { ...result, label: `Diagonal +${result.count}` }
  }

  if (piece === 'DRAIN') {
    return resolveDrain(state, move)
  }

  if (piece === 'FORT') {
    return resolveFort(state, move)
  }

  if (piece === 'BLOOM') {
    return resolveBloom(state, move)
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
  const chainFlips = applyChainFlips(state.board, state.currentPlayer, [target], state.turn)

  return {
    count: 1 + chainFlips.length,
    label: `Drop ${coordLabel(target)}${damage.label ? ` / ${damage.label}` : ''}`,
    effects: [
      ...damage.effects,
      { coord: target, type: 'place' },
      ...chainFlips.map((coord) => ({ coord, type: 'flip' as const })),
    ],
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
  const targets = cardinalDirections()
    .map((dir) => ({ x: move.x + dir.dx, y: move.y + dir.dy }))
    .filter((coord) => isInside(coord) && !getCell(state.board, coord).disc)

  const damaged = addDamageCells(state, targets, getOpponent(state.currentPlayer))

  return {
    count: 0,
    label: `Damage x${damaged.length}`,
    effects: damaged.map((coord) => ({ coord, type: 'damage' as const })),
  }
}

function resolveCross(state: MatchState, move: Coord): SpecialResult {
  const player = state.currentPlayer
  const targets = cardinalDirections()
    .map((dir) => findFirstFlippableOnRay(state, move, dir))
    .filter((target): target is Coord => Boolean(target))

  const flipped = targets.filter((target) => tryFlip(state.board, target, player, state.turn))
  const chainFlips = applyChainFlips(state.board, player, flipped, state.turn)

  return {
    count: flipped.length + chainFlips.length,
    label:
      flipped.length > 0
        ? `Cross +${flipped.length}${chainFlips.length > 0 ? ` / chain +${chainFlips.length}` : ''}`
        : 'Cross had no target',
    effects: [
      ...flipped.map((coord) => ({ coord, type: 'flip' as const })),
      ...chainFlips.map((coord) => ({ coord, type: 'flip' as const })),
    ],
  }
}

function resolveDiagonal(state: MatchState, move: Coord): SpecialResult {
  const player = state.currentPlayer
  const targets = uniqueCoords(
    diagonalDirections().flatMap((dir) => findFlippablesOnRay(state, move, dir)),
  )

  const flipped = targets.filter((target) => tryFlip(state.board, target, player, state.turn))
  const chainFlips = applyChainFlips(state.board, player, flipped, state.turn)

  return {
    count: flipped.length + chainFlips.length,
    label:
      flipped.length > 0
        ? `Diagonal +${flipped.length}${chainFlips.length > 0 ? ` / chain +${chainFlips.length}` : ''}`
        : 'Diagonal had no target',
    effects: [
      ...flipped.map((coord) => ({ coord, type: 'flip' as const })),
      ...chainFlips.map((coord) => ({ coord, type: 'flip' as const })),
    ],
  }
}

function findFirstFlippableOnRay(state: MatchState, origin: Coord, dir: Direction) {
  let cursor = { x: origin.x + dir.dx, y: origin.y + dir.dy }

  while (isInside(cursor)) {
    const disc = getCell(state.board, cursor).disc

    if (disc && canSpecialFlip(state.board, cursor, state.currentPlayer, state.turn)) {
      return cursor
    }

    cursor = { x: cursor.x + dir.dx, y: cursor.y + dir.dy }
  }

  return null
}

function findFlippablesOnRay(state: MatchState, origin: Coord, dir: Direction) {
  const targets: Coord[] = []
  let cursor = { x: origin.x + dir.dx, y: origin.y + dir.dy }

  while (isInside(cursor)) {
    if (canSpecialFlip(state.board, cursor, state.currentPlayer, state.turn)) {
      targets.push(cursor)
    }

    cursor = { x: cursor.x + dir.dx, y: cursor.y + dir.dy }
  }

  return targets
}

function resolveDrain(state: MatchState, move: Coord): SpecialResult {
  const player = state.currentPlayer
  const opponent = getOpponent(player)
  const drained = Math.min(2, state.specialPoints[opponent])

  if (drained) {
    state.specialPoints[opponent] -= drained
  }

  for (let index = 0; index < Math.max(1, drained); index += 1) {
    recoverSpecialPoint(state, player)
  }

  return {
    count: 0,
    label: drained ? `Drain +${drained}/-${drained}SP` : 'Drain +1SP',
    effects: [{ coord: move, type: 'charge' }],
  }
}

function resolveFort(state: MatchState, move: Coord): SpecialResult {
  const targets = [
    move,
    ...directions.map((dir) => ({ x: move.x + dir.dx, y: move.y + dir.dy })),
  ].filter((coord) => isInside(coord))

  const warded = uniqueCoords(targets).filter((coord) => addWard(state, coord))
  const damaged = addDamageCells(
    state,
    cardinalDirections()
      .map((dir) => ({ x: move.x + dir.dx, y: move.y + dir.dy }))
      .filter((coord) => isInside(coord) && !getCell(state.board, coord).disc),
    getOpponent(state.currentPlayer),
  )

  return {
    count: 0,
    label: `Fort x${warded.length} / Damage x${damaged.length}`,
    effects: [
      ...warded.map((coord) => ({ coord, type: 'guard' as const })),
      ...damaged.map((coord) => ({ coord, type: 'damage' as const })),
    ],
  }
}

function resolveBloom(state: MatchState, move: Coord): SpecialResult {
  const targets = shuffleCoords(
    directions
      .map((dir) => ({ x: move.x + dir.dx, y: move.y + dir.dy }))
      .filter((coord) => isInside(coord) && !getCell(state.board, coord).disc),
  ).slice(0, 3)

  if (targets.length === 0) {
    return { count: 0, label: 'Bloom had no target', effects: [] }
  }

  const damageEffects: VisualEffect[] = []

  for (const target of targets) {
    const cell = getCell(state.board, target)
    cell.disc = createDisc(state.currentPlayer, 'NORMAL')
    damageEffects.push(...applyDamageCellTrigger(state, target, state.currentPlayer).effects)
  }

  const chainFlips = applyChainFlips(state.board, state.currentPlayer, targets, state.turn)

  return {
    count: targets.length + chainFlips.length,
    label: `Bloom x${targets.length}${chainFlips.length > 0 ? ` / chain +${chainFlips.length}` : ''}`,
    effects: [
      ...damageEffects,
      ...targets.map((coord) => ({ coord, type: 'place' as const })),
      ...chainFlips.map((coord) => ({ coord, type: 'flip' as const })),
    ],
  }
}

function resolveDamageCombo(state: MatchState): SpecialResult {
  const target = chooseRandomCoord(getDamageTargets(state))

  if (!target) {
    return { count: 0, label: 'Damage no target', effects: [] }
  }

  const damaged = addDamageCells(state, [target], getOpponent(state.currentPlayer))

  return {
    count: 0,
    label: damaged.length > 0 ? `Damage ${coordLabel(target)}` : 'Damage no target',
    effects: damaged.map((coord) => ({ coord, type: 'damage' as const })),
  }
}

function cardinalDirections() {
  return directions.filter((dir) => Math.abs(dir.dx) + Math.abs(dir.dy) === 1)
}

function diagonalDirections() {
  return directions.filter((dir) => Math.abs(dir.dx) === 1 && Math.abs(dir.dy) === 1)
}

function getDamageTargets(state: MatchState) {
  return state.board
    .filter((cell) => !cell.disc)
    .map((cell) => cell.coord)
}

function addDamageCells(state: MatchState, targets: Coord[], damageFor: Player) {
  const validTargets = uniqueCoords(targets).filter((coord) => !getCell(state.board, coord).disc)
  const targetKeys = new Set(validTargets.map((coord) => `${coord.x}-${coord.y}`))

  state.damageCells = [
    ...state.damageCells.filter((cell) => !targetKeys.has(`${cell.coord.x}-${cell.coord.y}`)),
    ...validTargets.map((coord) => ({ coord, damageFor })),
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

  state.specialPoints[player] = Math.max(0, state.specialPoints[player] - 2)

  return {
    count: 0,
    label: 'Damage -2SP',
    effects: [{ coord, type: 'damage' }],
  }
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
  const targets = directions
    .map((dir) => ({ x: move.x + dir.dx, y: move.y + dir.dy }))
    .filter((target) => canSpecialFlip(state.board, target, player, state.turn))

  const flipped = targets.filter((target) => tryFlip(state.board, target, player, state.turn))
  const chainFlips = applyChainFlips(state.board, player, flipped, state.turn)

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

function addWard(state: MatchState, coord: Coord) {
  const disc = getCell(state.board, coord).disc

  if (disc?.owner !== state.currentPlayer) {
    return false
  }

  disc.statuses = disc.statuses.filter((status) => status.type !== 'GUARD')
  disc.statuses.push({ type: 'GUARD', charges: 1 })
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

  state.currentPlayer = nextPlayer
  state.turn += 1
  state.passesInRow = passesInRow

  if (!state.winner) {
    recoverSpecialPoint(state, state.currentPlayer)
  }

  expireTurnState(state)
}

function recoverSpecialPoint(state: MatchState, player: Player) {
  state.specialPoints[player] = Math.min(maxSpecialPoints, state.specialPoints[player] + 1)
}

function expireTurnState(state: MatchState) {
  const chargeEffects: VisualEffect[] = []

  for (const cell of state.board) {
    if (!cell.disc) {
      continue
    }

    const charges = cell.disc.statuses.filter(
      (status) =>
        status.type === 'CHARGE' &&
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
      (status) => status.type !== 'WARD' || (status.expiresAtTurn ?? 0) >= state.turn,
    )
  }

  state.placementBlocks = state.placementBlocks.filter(
    (block) => block.expiresAtTurn >= state.turn,
  )

  state.visualEffects = [...state.visualEffects, ...chargeEffects]
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
  const [page, setPage] = useState<AppPage>('game')
  const [state, setState] = useState(createInitialState)
  const [mode, setMode] = useState<GameMode>('local')
  const [decks, setDecks] = useState<Record<Player, SpecialPiece[]>>(defaultDecks)
  const [selectedPiece, setSelectedPiece] = useState<PieceType>('NORMAL')
  const [pendingBarrier, setPendingBarrier] = useState<PendingBarrier | null>(null)
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
  const barrierTargetMap = useMemo(
    () =>
      new Map(
        pendingBarrier
          ? getBarrierTargets(state, pendingBarrier).map((target) => [`${target.x}-${target.y}`, target])
          : [],
      ),
    [pendingBarrier, state],
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
  const usableSelectedPiece =
    selectedPiece === 'NORMAL' || currentDeck.includes(selectedPiece as SpecialPiece)
      ? canUsePiece(state, state.currentPlayer, selectedPiece)
        ? selectedPiece
        : 'NORMAL'
      : 'NORMAL'
  const isGameOver = Boolean(state.winner)
  const isCpuTurn = mode === 'cpu' && state.currentPlayer === cpuPlayer && !isGameOver && !pendingBarrier
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
      if (isGameOver || isCpuTurn || pendingBarrier || usableSelectedPiece === 'LANCE' || usableSelectedPiece === 'DROP') {
        return
      }

      if (usableSelectedPiece === 'BARRIER') {
        const started = applyBarrierPlacementStart(state, move)
        setState(started.next)
        setPendingBarrier(started.pending)
        return
      }

      setState(applyPlaceAction(state, usableSelectedPiece, move))
      setSelectedPiece('NORMAL')
      setHoveredMoveKey(null)
    },
    [isCpuTurn, isGameOver, pendingBarrier, state, usableSelectedPiece],
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

  function resetGame(nextMode = mode) {
    setState(createInitialState())
    setSelectedPiece('NORMAL')
    setPendingBarrier(null)
    setHoveredMoveKey(null)
    setMode(nextMode)
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

      if (selected.length >= maxDeckSize) {
        return current
      }

      return {
        ...current,
        [player]: [...selected, piece],
      }
    })
  }

  function startDeckGame() {
    resetGame(mode)
    setPage('game')
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
          <span className={`mini-disc ${state.currentPlayer.toLowerCase()}`} />
          <div>
            <strong>Turn {state.turn}</strong>
            <span>{isGameOver ? 'Game ended' : `${formatPlayer(state.currentPlayer)} to move`}</span>
          </div>
        </div>

        <div className="top-actions">
          <button type="button" onClick={() => setPage(page === 'deck' ? 'game' : 'deck')}>
            <Settings aria-hidden="true" />
            <span>{page === 'deck' ? 'Game' : 'Deck'}</span>
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

      {page === 'deck' ? (
        <DeckBuilder decks={decks} onToggle={toggleDeckPiece} onStart={startDeckGame} />
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
                  const placementBlock = placementBlockMap.get(moveKey)
                  const damageCell = damageCellMap.get(moveKey)
                  const isLegal = Boolean(
                    move &&
                      !isGameOver &&
                      !isCpuTurn &&
                      !pendingBarrier &&
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
                  const selected = cell.disc?.piece !== 'NORMAL'
                  const effect = visualEffectMap.get(moveKey)
                  const hasComboPreview = isLegal && comboPreviewMap.has(moveKey)
                  const isComboOrigin = hoveredComboOriginKeys.has(moveKey)

                  return (
                    <button
                      type="button"
                      className={`cell ${isLegal ? 'is-legal' : ''} ${isComboOrigin ? 'is-combo-origin' : ''} ${isReverseTarget ? 'is-reverse-target' : ''} ${isBarrierTarget ? 'is-barrier-target' : ''} ${isBarrierSelected ? 'is-barrier-selected' : ''} ${placementBlock ? 'is-placement-blocked' : ''} ${damageCell ? `is-damage-cell damage-for-${damageCell.damageFor.toLowerCase()}` : ''} ${selected ? 'has-special' : ''} ${effect ? `effect-${effect}` : ''}`}
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
                      disabled={!isLegal && !isReverseTarget && !isBarrierTarget}
                      aria-label={
                        isBarrierTarget
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

          <div className="piece-dock" aria-label="Piece selection">
            {(['NORMAL', ...currentDeck] as PieceType[]).map((piece) => {
              const disabled = !canUsePiece(state, state.currentPlayer, piece) || isCpuTurn || isGameOver
              return (
                <button
                  type="button"
                  className={`piece-button ${pieceInfo[piece].tone} ${usableSelectedPiece === piece ? 'is-selected' : ''}`}
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
                  <small>{piece === 'NORMAL' ? 'Free' : `SP${specialCost[piece]}`}</small>
                </button>
              )
            })}
          </div>

          {pendingBarrier ? (
            <button type="button" className="finish-barrier-button" onClick={finishBarrier}>
              アンカー選択を完了 ({pendingBarrier.selected.length}/2)
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
                <span>Cost {specialCost[usableSelectedPiece]}</span>
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
              <li>各プレイヤーはSP0から開始。自分のターンが来るたびにSPを1回復し、所持上限は5です。</li>
              <li>両者が打てなくなったら終局し、石数が多い方の勝ちです。</li>
            </ol>
          </section>

          <section className="mode-card">
            <button
              type="button"
              className={mode === 'local' ? 'is-active' : ''}
              onClick={() => resetGame('local')}
            >
              <Users aria-hidden="true" />
              Local
            </button>
            <button
              type="button"
              className={mode === 'cpu' ? 'is-active' : ''}
              onClick={() => resetGame('cpu')}
            >
              <Bot aria-hidden="true" />
              CPU
            </button>
          </section>
        </aside>
      </section>
      )}
    </main>
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

  return `${formatPlayer(state.currentPlayer)} has ${legalMoveCount} legal moves.`
}

function DeckBuilder({
  decks,
  onToggle,
  onStart,
}: {
  decks: Record<Player, SpecialPiece[]>
  onToggle: (player: Player, piece: SpecialPiece) => void
  onStart: () => void
}) {
  const canStart = decks.BLACK.length > 0 && decks.WHITE.length > 0

  return (
    <section className="deck-page" aria-label="Deck builder">
      <div className="deck-header">
        <div>
          <h1>Deck Builder</h1>
          <p>各プレイヤーは能力駒を最大3つまで選択できます。</p>
        </div>
        <button type="button" className="start-game-button" disabled={!canStart} onClick={onStart}>
          Start Game
        </button>
      </div>

      <div className="deck-columns">
        {(['BLACK', 'WHITE'] as Player[]).map((player) => (
          <section className="deck-panel" key={player}>
            <div className="deck-panel-header">
              <span className={`mini-disc ${player.toLowerCase()}`} />
              <div>
                <h2>{player === 'BLACK' ? 'Player 1 Deck' : 'Player 2 Deck'}</h2>
                <p>{decks[player].length}/{maxDeckSize}</p>
              </div>
            </div>

            <div className="deck-slots" aria-label={`${formatPlayer(player)} selected deck`}>
              {Array.from({ length: maxDeckSize }).map((_, index) => {
                const piece = decks[player][index]
                return (
                  <span className={`deck-slot ${piece ? pieceInfo[piece].tone : ''}`} key={`${player}-${index}`}>
                    {piece ? <PieceIcon piece={piece} /> : null}
                  </span>
                )
              })}
            </div>

            <div className="deck-card-grid">
              {specialPieces.map((piece) => {
                const selected = decks[player].includes(piece)
                const locked = !selected && decks[player].length >= maxDeckSize

                return (
                  <button
                    type="button"
                    className={`deck-card ${pieceInfo[piece].tone} ${selected ? 'is-selected' : ''}`}
                    key={`${player}-${piece}`}
                    disabled={locked}
                    onClick={() => onToggle(player, piece)}
                  >
                    <span className={`ability-icon ${pieceInfo[piece].tone}`}>
                      <PieceIcon piece={piece} />
                    </span>
                    <strong>{pieceInfo[piece].label}</strong>
                    <small>SP{specialCost[piece]}</small>
                    <span>{pieceInfo[piece].summary}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
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
        <span>SP {sp}</span>
        <span>R{specialCost.LANCE}</span>
        <span>B{specialCost.BLAST}</span>
        <span>A{specialCost.BARRIER}</span>
        <span>S{specialCost.SEAL}</span>
        <span>D{specialCost.DROP}</span>
        <span>C{specialCost.CHARGE}</span>
        <span>G{specialCost.DAMAGE}</span>
        <span>X{specialCost.CROSS}</span>
        <span>I{specialCost.DIAGONAL}</span>
        <span>V{specialCost.DRAIN}</span>
        <span>F{specialCost.FORT}</span>
        <span>M{specialCost.BLOOM}</span>
      </div>
      {currentPlayer === player ? <em>Your turn</em> : null}
    </section>
  )
}

function DiscView({ disc }: { disc: Disc }) {
  const isInactiveCharge =
    disc.piece === 'CHARGE' && !disc.statuses.some((status) => status.type === 'CHARGE')

  return (
    <span
      className={`disc ${disc.owner.toLowerCase()} ${pieceInfo[disc.piece].tone} ${
        isInactiveCharge ? 'inactive-charge' : ''
      }`}
    >
      {disc.piece !== 'NORMAL' ? <PieceIcon piece={disc.piece} /> : null}
      {disc.statuses.some((status) => status.type === 'GUARD') ? <i className="guard-badge" /> : null}
      {disc.statuses.some((status) => status.type === 'WARD') ? <i className="ward-badge" /> : null}
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
  if (piece === 'CROSS') return <Crosshair aria-hidden="true" />
  if (piece === 'DIAGONAL') return <Zap aria-hidden="true" />
  if (piece === 'DRAIN') return <Magnet aria-hidden="true" />
  if (piece === 'FORT') return <Shield aria-hidden="true" />
  if (piece === 'BLOOM') return <Shuffle aria-hidden="true" />
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
    DAMAGE: 'ダメージ: 相手が置くとSP2を失うマスを作る',
    CROSS: 'クロス: 上下左右の射線で最初の相手石を返す',
    DIAGONAL: 'ダイア: 斜めライン上の相手石をまとめて返す',
    DRAIN: 'ドレイン: 相手SPを最大2奪って自分SPにする',
    FORT: 'フォート: 周囲の自分石を守り、前後左右をダメージ化',
    BLOOM: 'ブルーム: 周囲の空きマスに自分の通常石を最大3つ増やす',
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
    set(7, 'preview-damage')
    set(11, 'preview-damage')
    set(12, 'preview-disc black preview-new', 'DAMAGE')
    set(13, 'preview-damage')
    set(17, 'preview-damage')
    return empty
  }

  if (piece === 'CROSS') {
    set(7, 'preview-disc white preview-extra')
    set(11, 'preview-disc white preview-extra')
    set(12, 'preview-disc black preview-new', 'CROSS')
    set(13, 'preview-disc white preview-extra')
    set(17, 'preview-disc white preview-extra')
    return empty
  }

  if (piece === 'DIAGONAL') {
    set(6, 'preview-disc white preview-extra')
    set(8, 'preview-disc white preview-extra')
    set(12, 'preview-disc black preview-new', 'DIAGONAL')
    set(16, 'preview-disc white preview-extra')
    set(18, 'preview-disc white preview-extra')
    return empty
  }

  if (piece === 'DRAIN') {
    set(7, 'preview-plus')
    set(12, 'preview-disc black preview-new', 'DRAIN')
    set(17, 'preview-damage')
    return empty
  }

  if (piece === 'FORT') {
    set(7, 'preview-disc black preview-ward')
    set(11, 'preview-disc black preview-ward')
    set(12, 'preview-disc black preview-new', 'FORT')
    set(13, 'preview-disc black preview-ward')
    set(17, 'preview-disc black preview-ward')
    return empty
  }

  if (piece === 'BLOOM') {
    set(6, 'preview-random')
    set(12, 'preview-disc black preview-new', 'BLOOM')
    set(18, 'preview-disc black preview-new')
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
