const express = require('express');
const http = require('http');
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static('public'));

// État de la partie partagé entre les deux joueurs
let gameState = null;
let players = { north: null, south: null };
let waitingPlayers = [];

// Créer ou rejoindre une partie
app.post('/api/join', (req, res) => {
  const { playerName } = req.body;
  
  if (!players.south) {
    players.south = playerName || 'Sud';
    gameState = createGame('south');
    res.json({ 
      ok: true, 
      role: 'south', 
      message: 'Tu es Sud. Attends que Nord se connecte...',
      gameState 
    });
  } else if (!players.north) {
    players.north = playerName || 'Nord';
    res.json({ 
      ok: true, 
      role: 'north', 
      message: 'Tu es Nord. La partie commence !',
      gameState 
    });
  } else {
    res.json({ ok: false, message: 'Partie pleine !' });
  }
});

// Jouer un coup
app.post('/api/move', (req, res) => {
  const { player, pitIndex } = req.body;
  
  if (!gameState) {
    return res.json({ ok: false, error: 'Pas de partie en cours.' });
  }
  
  const result = applyMove(gameState, { player, pitIndex });
  
  if (!result.ok) {
    return res.json({ ok: false, error: result.error });
  }
  
  gameState = result.state;
  res.json({ ok: true, gameState, action: result.action });
});

// Lire l'état actuel (polling Ajax)
app.get('/api/state', (req, res) => {
  res.json({ 
    ok: true, 
    gameState,
    players 
  });
});

// Réinitialiser la partie
app.post('/api/reset', (req, res) => {
  gameState = createGame('south');
  players = { north: null, south: null };
  res.json({ ok: true, gameState });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Serveur Songho démarré sur le port ' + PORT);
});

// ============================================================
// MOTEUR DE JEU (identique Version 1)
// ============================================================

const CYCLE = [
  {p:"north",i:0},{p:"north",i:1},{p:"north",i:2},{p:"north",i:3},{p:"north",i:4},{p:"north",i:5},{p:"north",i:6},
  {p:"south",i:6},{p:"south",i:5},{p:"south",i:4},{p:"south",i:3},{p:"south",i:2},{p:"south",i:1},{p:"south",i:0}
];

function other(p){ return p==="north"?"south":"north"; }
function sum(a){ return a.reduce((t,v)=>t+v,0); }
function samePos(a,b){ return a.p===b.p && a.i===b.i; }
function cycleIndexOf(pos){ return CYCLE.findIndex(c=>samePos(c,pos)); }

function nextPositionsAfter(source){
  const start = cycleIndexOf(source);
  const result = [];
  for(let step=1; step<=13; step++) result.push(CYCLE[(start+step)%14]);
  return result;
}

function attackPit(p){ return p==="north"?{p:"north",i:6}:{p:"south",i:0}; }
function opponentFirstPit(p){ return p==="north"?{p:"south",i:6}:{p:"north",i:0}; }

function opponentPath(p){
  return p==="north"
    ?[{p:"south",i:6},{p:"south",i:5},{p:"south",i:4},{p:"south",i:3},{p:"south",i:2},{p:"south",i:1},{p:"south",i:0}]
    :[{p:"north",i:0},{p:"north",i:1},{p:"north",i:2},{p:"north",i:3},{p:"north",i:4},{p:"north",i:5},{p:"north",i:6}];
}

function cloneState(s){
  return {
    board:{ north:[...s.board.north], south:[...s.board.south] },
    scores:{ north:s.scores.north, south:s.scores.south },
    currentPlayer:s.currentPlayer,
    status:s.status,
    winner:s.winner,
    reason:s.reason,
    moveNumber:s.moveNumber,
    history:[...s.history]
  };
}

function boardSeeds(s){ return sum(s.board.north)+sum(s.board.south); }
function totalSeeds(s){ return s.scores.north+s.scores.south+boardSeeds(s); }

function createGame(startingPlayer="south"){
  return {
    board:{ north:[5,5,5,5,5,5,5], south:[5,5,5,5,5,5,5] },
    scores:{ north:0, south:0 },
    currentPlayer:startingPlayer,
    status:"playing",
    winner:null,
    reason:null,
    moveNumber:0,
    history:[]
  };
}

function sowNormal(state, player, pitIndex){
  const seeds = state.board[player][pitIndex];
  const source = {p:player, i:pitIndex};
  const visited = [];
  state.board[player][pitIndex] = 0;
  const path = nextPositionsAfter(source);
  for(let i=0; i<seeds; i++){
    const pos = path[i];
    state.board[pos.p][pos.i]++;
    visited.push(pos);
  }
  return { visited, lastPosition:visited[visited.length-1], specialCapture:0 };
}

function sowGranary(state, player, pitIndex){
  const seeds = state.board[player][pitIndex];
  const source = {p:player, i:pitIndex};
  const visited = [];
  let remaining = seeds;
  let specialCapture = 0;
  state.board[player][pitIndex] = 0;
  for(const pos of nextPositionsAfter(source)){
    state.board[pos.p][pos.i]++;
    visited.push(pos);
    remaining--;
  }
  const path = opponentPath(player);
  for(let i=0; i<remaining; i++){
    const pos = path[i % path.length];
    const isLast = i===remaining-1;
    const isFirst = samePos(pos, opponentFirstPit(player));
    if(isLast && isFirst){ specialCapture++; visited.push(pos); continue; }
    state.board[pos.p][pos.i]++;
    visited.push(pos);
  }
  return { visited, lastPosition:visited[visited.length-1], specialCapture };
}

function sow(state, player, pitIndex){
  const seeds = state.board[player][pitIndex];
  if(seeds<=0) throw new Error("Case vide.");
  return seeds<=13 ? sowNormal(state,player,pitIndex) : sowGranary(state,player,pitIndex);
}

function isCaptureValue(n){ return n===2||n===3||n===4; }

function isOpponentPit(player, pos){ return pos.p===other(player); }

function canStartCapture(state, player, last){
  if(!last || !isOpponentPit(player,last)) return false;
  if(samePos(last, opponentFirstPit(player))) return false;
  return isCaptureValue(state.board[last.p][last.i]);
}

function captureChainPositions(state, player, last){
  const path = opponentPath(player);
  const lastIdx = path.findIndex(pos=>samePos(pos,last));
  if(lastIdx<=0) return [];
  const captured = [];
  for(let idx=lastIdx; idx>=0; idx--){
    const pos = path[idx];
    const count = state.board[pos.p][pos.i];
    if(!isCaptureValue(count)) break;
    captured.push({p:pos.p, i:pos.i, seeds:count});
  }
  return captured;
}

function wouldEmptyOpponent(state, player, captureList){
  const opp = other(player);
  const remaining = [...state.board[opp]];
  for(const c of captureList) remaining[c.i] -= c.seeds;
  return sum(remaining)===0;
}

function applyCaptureIfAllowed(state, player, captureList){
  if(captureList.length===0) return 0;
  if(wouldEmptyOpponent(state, player, captureList)) return 0;
  let total=0;
  for(const c of captureList){
    state.board[c.p][c.i] -= c.seeds;
    total += c.seeds;
  }
  state.scores[player] += total;
  return total;
}

function resolveCaptures(state, player, sowResult){
  if(sowResult.specialCapture>0){
    state.scores[player] += sowResult.specialCapture;
    return { captured:sowResult.specialCapture, type:"special-granary" };
  }
  const last = sowResult.lastPosition;
  if(!canStartCapture(state, player, last)) return { captured:0, type:"none" };
  const captureList = captureChainPositions(state, player, last);
  const captured = applyCaptureIfAllowed(state, player, captureList);
  return {
    captured,
    type: captured>0 && captureList.length>1 ? "chain" : "normal",
    cancelledStarvation: captured===0 && captureList.length>0
  };
}

function isAttackPitMove(player, pitIndex){
  const a = attackPit(player);
  return a.p===player && a.i===pitIndex;
}

function wouldMoveCapture(state, player, pitIndex){
  const sim = cloneState(state);
  const sowing = sow(sim, player, pitIndex);
  if(sowing.specialCapture>0) return true;
  return canStartCapture(sim, player, sowing.lastPosition);
}

function isForbiddenAttackMove(state, player, pitIndex){
  if(!isAttackPitMove(player, pitIndex)) return false;
  const seeds = state.board[player][pitIndex];
  if(seeds===1) return true;
  if(seeds===2) return !wouldMoveCapture(state, player, pitIndex);
  return false;
}

function opponentCampIsEmpty(state, player){ return sum(state.board[other(player)])===0; }

function countDeliveredToOpponent(state, player, pitIndex){
  const sim = cloneState(state);
  const before = sum(sim.board[other(player)]);
  sow(sim, player, pitIndex);
  return sum(sim.board[other(player)]) - before;
}

function ownNonEmptyMoves(state, player){
  const moves=[];
  for(let i=0;i<7;i++) if(state.board[player][i]>0) moves.push({player,pitIndex:i});
  return moves;
}

function getSolidarityMoves(state, player){
  const candidates = ownNonEmptyMoves(state, player);
  const ordinary = candidates.filter(m=>!isForbiddenAttackMove(state,player,m.pitIndex));
  const enriched = ordinary.map(m=>({...m, delivered:countDeliveredToOpponent(state,player,m.pitIndex)}));
  const atLeast7 = enriched.filter(m=>m.delivered>=7);
  if(atLeast7.length>0) return atLeast7;
  const positive = enriched.filter(m=>m.delivered>0);
  if(positive.length>0){
    const maxD = Math.max(...positive.map(m=>m.delivered));
    return positive.filter(m=>m.delivered===maxD);
  }
  const forced = candidates.filter(m=>isAttackPitMove(player,m.pitIndex)&&[1,2].includes(state.board[player][m.pitIndex]));
  return forced.map(m=>({...m, forcedDonation:true}));
}

function getLegalMoves(state){
  if(state.status!=="playing") return [];
  const player = state.currentPlayer;
  if(opponentCampIsEmpty(state, player)) return getSolidarityMoves(state, player);
  return ownNonEmptyMoves(state, player).filter(m=>!isForbiddenAttackMove(state,player,m.pitIndex));
}

function applyForcedDonation(state, player, pitIndex){
  const seeds = state.board[player][pitIndex];
  state.board[player][pitIndex]=0;
  state.scores[other(player)] += seeds;
  return { type:"forced-donation", donated:seeds };
}

function collectRemainingSeeds(state){
  state.scores.north += sum(state.board.north);
  state.scores.south += sum(state.board.south);
  state.board.north=[0,0,0,0,0,0,0];
  state.board.south=[0,0,0,0,0,0,0];
}

function computeWinner(state){
  if(state.scores.north>=40) return "north";
  if(state.scores.south>=40) return "south";
  return "draw";
}

function resolveEndGameAfterMove(state){
  if(state.scores.north>=40||state.scores.south>=40){
    state.status="ended"; state.reason="score_40"; state.winner=computeWinner(state); return;
  }
  if(boardSeeds(state)<10){
    collectRemainingSeeds(state);
    state.status="ended"; state.reason="low_board"; state.winner=computeWinner(state); return;
  }
}

function resolveEndGameBeforeTurn(state){
  const moves = getLegalMoves(state);
  if(moves.length>0) return;
  collectRemainingSeeds(state);
  state.status="ended"; state.reason="solidarity_impossible"; state.winner=computeWinner(state);
}

function assertTotalSeeds(state){
  const total = totalSeeds(state);
  if(total!==70) throw new Error("Invariant cassé : "+total+" graines.");
}

function validateMove(state, move){
  if(state.status!=="playing") return {ok:false, reason:"Partie terminée."};
  if(move.player!==state.currentPlayer) return {ok:false, reason:"Pas ton tour."};
  if(move.pitIndex<0||move.pitIndex>6) return {ok:false, reason:"Case inconnue."};
  if(state.board[move.player][move.pitIndex]<=0) return {ok:false, reason:"Case vide."};
  const legal = getLegalMoves(state);
  const isLegal = legal.some(m=>m.player===move.player&&m.pitIndex===move.pitIndex);
  if(!isLegal) return {ok:false, reason:"Coup interdit."};
  return {ok:true};
}

function applyMove(state, move){
  const v = validateMove(state, move);
  if(!v.ok) return { state, ok:false, error:v.reason };
  const legal = getLegalMoves(state).find(m=>m.player===move.player&&m.pitIndex===move.pitIndex);
  let actionResult;
  if(legal && legal.forcedDonation){
    actionResult = applyForcedDonation(state, move.player, move.pitIndex);
  } else {
    const sowing = sow(state, move.player, move.pitIndex);
    const capture = resolveCaptures(state, move.player, sowing);
    actionResult = { type:"sow", sowing, capture };
  }
  state.moveNumber++;
  state.history.push({ moveNumber:state.moveNumber, player:move.player, pitIndex:move.pitIndex, result:actionResult });
  resolveEndGameAfterMove(state);
  if(state.status==="playing"){
    state.currentPlayer = other(state.currentPlayer);
    resolveEndGameBeforeTurn(state);
  }
  assertTotalSeeds(state);
  return { state, ok:true, action:actionResult };
             }
