import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Anchor,
  Ban,
  Bot,
  CircleHelp,
  CirclePlus,
  Flag,
  Menu,
  RotateCcw,
  Settings,
  Shield,
  Sparkle,
  Users,
} from 'lucide-react'
import './App.css'

type Player = 'BLACK' | 'WHITE'
type GameMode = 'local' | 'cpu'
type PieceType = 'NORMAL' | 'ANCHOR' | 'LANCE' | 'BLAST' | 'BARRIER' | 'SEAL' | 'DROP'
type StatusType = 'GUARD' | 'WARD'
type Coord = { x: number; y: number }
type Direction = { dx: number; dy: number; key: string }

type Status = {
  type: StatusType
  expiresAtTurn?: number
  charges?: number
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

type Reserve = Record<Exclude<PieceType, 'NORMAL'>, number>

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
  type: 'flip' | 'guard' | 'ward' | 'block' | 'place'
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
}

type PlacementBlock = {
  coord: Coord
  blockedFor: Player
  expiresAtTurn: number
}

const boardSize = 8
const cpuPlayer: Player = 'WHITE'
const specialPieces: Exclude<PieceType, 'NORMAL'>[] = [
  'ANCHOR',
  'LANCE',
  'BLAST',
  'BARRIER',
  'SEAL',
  'DROP',
]
const directions: Direction[] = [-1, 0, 1].flatMap((dy) =>
  [-1, 0, 1]
    .filter((dx) => dx !== 0 || dy !== 0)
    .map((dx) => ({ dx, dy, key: `${dx}:${dy}` })),
)
const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const rows = ['1', '2', '3', '4', '5', '6', '7', '8']

const specialCost: Record<PieceType, number> = {
  NORMAL: 0,
  ANCHOR: 1,
  LANCE: 2,
  BLAST: 3,
  BARRIER: 3,
  SEAL: 2,
  DROP: 2,
}

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
  ANCHOR: {
    label: 'アンカー',
    short: 'A',
    tone: 'anchor',
    summary: '置いた駒が1回だけ守られます。',
    hint: 'この駒が相手に返されそうになった最初の1回だけ無効化します。大事な場所を一手だけ守りたい時に使います。',
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
    label: 'バリア',
    short: 'W',
    tone: 'barrier',
    summary: '置いた石と選んだ自分の石を守ります。',
    hint: '置いた駒自身と返した近い石に保護を付け、さらに盤上の自分の石を最大3枚選んで保護できます。相手の次の1ターン中、その石は返されません。',
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
    specialPoints: { BLACK: 10, WHITE: 10 },
    reserve: {
      BLACK: createReserve(),
      WHITE: createReserve(),
    },
    winner: null,
    events: [],
    visualEffects: [],
    placementBlocks: [],
  }
}

function createReserve(): Reserve {
  return { ANCHOR: 0, LANCE: 0, BLAST: 0, BARRIER: 0, SEAL: 0, DROP: 0 }
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

  const flippedByRule: Coord[] = []
  for (const line of move.captured) {
    for (const coord of line.coords) {
      if (tryFlip(next.board, coord, player, next.turn)) {
        flippedByRule.push(coord)
      }
    }
  }

  const special = resolveSpecialEffect(next, piece, move)
  next.visualEffects = special.effects

  if (piece !== 'NORMAL') {
    next.specialPoints[player] -= specialCost[piece]
  }

  next.events = [
    {
      turn: next.turn,
      player,
      piece,
      at: { x: move.x, y: move.y },
      captured: flippedByRule.length + special.count,
      special: special.label,
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

  const flippedByRule: Coord[] = []
  for (const line of move.captured) {
    for (const coord of line.coords) {
      if (tryFlip(next.board, coord, player, next.turn)) {
        flippedByRule.push(coord)
      }
    }
  }

  const baseWarded = applyBaseBarrier(next, move)
  next.specialPoints[player] -= specialCost.BARRIER
  next.visualEffects = baseWarded.map((coord) => ({ coord, type: 'ward' }))

  return {
    next,
    pending: {
      move: { x: move.x, y: move.y },
      baseWarded,
      selected: [],
      captured: flippedByRule.length,
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
  next.visualEffects = warded.map((coord) => ({ coord, type: 'ward' }))
  const event: MatchEvent = {
    turn: next.turn,
    player,
    piece: 'BARRIER',
    at: pending.move,
    captured: pending.captured,
    special: `WARD x${warded.length}`,
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
  const chainFlips = flipped ? applyChainFlips(next.board, player, [target], next.turn) : []

  if (flipped) {
    next.specialPoints[player] -= specialCost.LANCE
  }

  next.visualEffects = [
    ...(flipped ? [{ coord: target, type: 'flip' as const }] : []),
    ...chainFlips.map((coord) => ({ coord, type: 'flip' as const })),
  ]
  const event: MatchEvent = {
    turn: next.turn,
    player,
    piece: 'LANCE',
    at: target,
    captured: (flipped ? 1 : 0) + chainFlips.length,
    special: flipped
      ? `Reverse +${coordLabel(target)}${chainFlips.length > 0 ? ` / chain +${chainFlips.length}` : ''}`
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

  if (canPlace) {
    cell.disc = createDisc(player, 'DROP')
    chainFlips.push(...applyChainFlips(next.board, player, [target], next.turn))
    next.specialPoints[player] -= specialCost.DROP
  }

  next.visualEffects = [
    ...(canPlace ? [{ coord: target, type: 'place' as const }] : []),
    ...chainFlips.map((coord) => ({ coord, type: 'flip' as const })),
  ]
  const event: MatchEvent = {
    turn: next.turn,
    player,
    piece: 'DROP',
    at: target,
    captured: (canPlace ? 1 : 0) + chainFlips.length,
    special: canPlace
      ? `Drop ${coordLabel(target)}${chainFlips.length > 0 ? ` / chain +${chainFlips.length}` : ''}`
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
  }
}

function resolveSpecialEffect(state: MatchState, piece: PieceType, move: MoveResult): SpecialResult {
  switch (piece) {
    case 'ANCHOR':
      getCell(state.board, move).disc?.statuses.push({ type: 'GUARD', charges: 1 })
      return { count: 0, label: 'GUARD applied', effects: [{ coord: move, type: 'guard' }] }
    case 'LANCE':
      return resolveReverse(state, move)
    case 'BLAST':
      return resolveBlast(state, move)
    case 'BARRIER':
      return resolveBarrier(state, move)
    case 'SEAL':
      return resolveSeal(state, move)
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
  const used = new Set([...pending.baseWarded, ...pending.selected].map((coord) => `${coord.x}-${coord.y}`))
  return state.board
    .filter((cell) => cell.disc?.owner === state.currentPlayer)
    .map((cell) => cell.coord)
    .filter((coord) => !used.has(`${coord.x}-${coord.y}`))
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
    label: `WARD x${warded.length}`,
    effects: warded.map((coord) => ({ coord, type: 'ward' })),
  }
}

function applyBaseBarrier(state: MatchState, move: MoveResult) {
  const bestLine = move.captured
    .filter((line) => line.coords.length > 0)
    .toSorted((a, b) => b.coords.length - a.coords.length)[0]

  const targets = [move, ...(bestLine?.coords.slice(0, 2) ?? [])]
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

  disc.statuses = disc.statuses.filter((status) => status.type !== 'WARD')
  disc.statuses.push({ type: 'WARD', expiresAtTurn: state.turn + 1 })
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
  expireTurnState(state)
}

function expireTurnState(state: MatchState) {
  for (const cell of state.board) {
    if (!cell.disc) {
      continue
    }

    cell.disc.statuses = cell.disc.statuses.filter(
      (status) => status.type !== 'WARD' || (status.expiresAtTurn ?? 0) >= state.turn,
    )
  }

  state.placementBlocks = state.placementBlocks.filter(
    (block) => block.expiresAtTurn >= state.turn,
  )
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

function chooseCpuMove(state: MatchState, moves: MoveResult[]) {
  const piece = pickCpuPiece(state)

  return {
    piece,
    move: moves.toSorted((a, b) => scoreMove(b, piece) - scoreMove(a, piece))[0],
  }
}

function pickCpuPiece(state: MatchState): PieceType {
  const usable = specialPieces.filter((piece) => canUsePiece(state, cpuPlayer, piece))

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

function App() {
  const [state, setState] = useState(createInitialState)
  const [mode, setMode] = useState<GameMode>('local')
  const [selectedPiece, setSelectedPiece] = useState<PieceType>('NORMAL')
  const [pendingBarrier, setPendingBarrier] = useState<PendingBarrier | null>(null)

  const legalMoves = useMemo(
    () => getLegalMovesForState(state, state.currentPlayer),
    [state],
  )
  const moveMap = useMemo(
    () => new Map(legalMoves.map((move) => [`${move.x}-${move.y}`, move])),
    [legalMoves],
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
  const usableSelectedPiece = canUsePiece(state, state.currentPlayer, selectedPiece)
    ? selectedPiece
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
      ? `追加でバリアを付与する自分の石を選んでください (${pendingBarrier.selected.length}/3)。完了ボタンでターン終了。`
      : getStatusMessage(state, legalMoves.length)

  useEffect(() => {
    if (!isCpuTurn || legalMoves.length === 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setState((current) => {
        const currentMoves = getLegalMovesForState(current, current.currentPlayer)
        const choice = chooseCpuMove(current, currentMoves)
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
  }, [isCpuTurn, legalMoves.length])

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
    },
    [isCpuTurn, isGameOver, pendingBarrier, state, usableSelectedPiece],
  )

  const handleDropUse = useCallback(() => {
    if (isGameOver || isCpuTurn || usableSelectedPiece !== 'DROP') {
      return
    }

    setState(applyDirectDropAction(state))
  }, [isCpuTurn, isGameOver, state, usableSelectedPiece])

  const handleReverseTarget = useCallback(
    (target: Coord) => {
      if (isGameOver || isCpuTurn || usableSelectedPiece !== 'LANCE') {
        return
      }

      setState(applyDirectReverseAction(state, target))
    },
    [isCpuTurn, isGameOver, state, usableSelectedPiece],
  )

  const handleBarrierTarget = useCallback(
    (target: Coord) => {
      if (!pendingBarrier || pendingBarrier.selected.length >= 3) {
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
  }, [pendingBarrier, state])

  function resetGame(nextMode = mode) {
    setState(createInitialState())
    setSelectedPiece('NORMAL')
    setPendingBarrier(null)
    setMode(nextMode)
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
          <button type="button" onClick={() => resetGame()} title="Undo is not available yet">
            <RotateCcw aria-hidden="true" />
            <span>Reset</span>
          </button>
          <button type="button" title="Settings">
            <Settings aria-hidden="true" />
            <span>Settings</span>
          </button>
          <button type="button" title="Help">
            <CircleHelp aria-hidden="true" />
            <span>Help</span>
          </button>
        </div>
      </header>

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
                {state.board.map((cell) => {
                  const move = moveMap.get(`${cell.coord.x}-${cell.coord.y}`)
                  const reverseTarget = reverseTargets.get(`${cell.coord.x}-${cell.coord.y}`)
                  const barrierTarget = barrierTargetMap.get(`${cell.coord.x}-${cell.coord.y}`)
                  const placementBlock = placementBlockMap.get(`${cell.coord.x}-${cell.coord.y}`)
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
                  const selected = cell.disc?.piece !== 'NORMAL'
                  const effect = visualEffectMap.get(`${cell.coord.x}-${cell.coord.y}`)

                  return (
                    <button
                      type="button"
                      className={`cell ${isLegal ? 'is-legal' : ''} ${isReverseTarget ? 'is-reverse-target' : ''} ${isBarrierTarget ? 'is-barrier-target' : ''} ${placementBlock ? 'is-placement-blocked' : ''} ${selected ? 'has-special' : ''} ${effect ? `effect-${effect}` : ''}`}
                      key={`${cell.coord.x}-${cell.coord.y}`}
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
                          ? `${coordLabel(cell.coord)}に追加バリアを付与する`
                          : isReverseTarget
                          ? `${coordLabel(cell.coord)}の相手石をリバースで返す`
                          : isLegal
                          ? `${coordLabel(cell.coord)}に${activeInfo.label}を置く`
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
            {(['NORMAL', ...specialPieces] as PieceType[]).map((piece) => {
              const disabled = !canUsePiece(state, state.currentPlayer, piece) || isCpuTurn || isGameOver
              return (
                <button
                  type="button"
                  className={`piece-button ${pieceInfo[piece].tone} ${selectedPiece === piece ? 'is-selected' : ''}`}
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
              バリア選択を完了 ({pendingBarrier.selected.length}/3)
            </button>
          ) : null}

          <p className="board-hint">{message}</p>
        </section>

        <aside className="right-rail">
          <section className="rail-card">
            <h2>Piece Abilities</h2>
            <AbilityList />
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
              <li>各プレイヤーはSP10から開始。スキルの使用回数制限はなく、SPが足りる限り使えます。</li>
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
        <span>A{specialCost.ANCHOR}</span>
        <span>R{specialCost.LANCE}</span>
        <span>B{specialCost.BLAST}</span>
        <span>W{specialCost.BARRIER}</span>
        <span>S{specialCost.SEAL}</span>
        <span>D{specialCost.DROP}</span>
      </div>
      {currentPlayer === player ? <em>Your turn</em> : null}
    </section>
  )
}

function DiscView({ disc }: { disc: Disc }) {
  return (
    <span className={`disc ${disc.owner.toLowerCase()} ${pieceInfo[disc.piece].tone}`}>
      {disc.piece !== 'NORMAL' ? <PieceIcon piece={disc.piece} /> : null}
      {disc.statuses.some((status) => status.type === 'GUARD') ? <i className="guard-badge" /> : null}
      {disc.statuses.some((status) => status.type === 'WARD') ? <i className="ward-badge" /> : null}
    </span>
  )
}

function PieceIcon({ piece }: { piece: PieceType }) {
  if (piece === 'ANCHOR') return <Anchor aria-hidden="true" />
  if (piece === 'LANCE') return <RotateCcw aria-hidden="true" />
  if (piece === 'BLAST') return <Sparkle aria-hidden="true" />
  if (piece === 'BARRIER') return <Shield aria-hidden="true" />
  if (piece === 'SEAL') return <Ban aria-hidden="true" />
  if (piece === 'DROP') return <CirclePlus aria-hidden="true" />
  return <span className="normal-dot" aria-hidden="true" />
}

function AbilityList() {
  return (
    <div className="ability-list">
      {specialPieces.map((piece) => (
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
    ANCHOR: 'アンカー: 置いた駒に1回だけ反転防止マーク',
    LANCE: 'リバース: 盤上の相手石を1枚選んで直接返す',
    BLAST: 'ブラスト: 周囲8マスの隣接相手駒をすべて返す',
    BARRIER: 'バリア: 置いた石と選んだ自分の石を次の相手番だけ保護',
    SEAL: 'シール: 周囲の空きマスを相手だけ次ターンまで封鎖',
    DROP: 'ドロップ: ランダムな空きマスに自分の石を置く',
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

  if (piece === 'ANCHOR') {
    set(12, 'preview-disc black preview-new', 'ANCHOR')
    set(7, 'preview-shield')
    set(17, 'preview-blocked')
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

  set(10, 'preview-disc black preview-new', 'BARRIER')
  set(11, 'preview-disc black preview-ward')
  set(12, 'preview-disc black preview-ward')
  set(13, 'preview-disc black preview-ward')
  set(16, 'preview-disc black preview-ward')
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
