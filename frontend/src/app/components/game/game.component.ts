import { Component, OnInit, OnDestroy, HostListener, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SocketService } from '../../services/socket.service';

@Component({
  selector: 'app-game',
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.css']
})
export class GameComponent implements OnInit, OnDestroy {
  roomCode: string = '';
  username: string = '';
  isHost: boolean = false;
  players: any[] = [];
  gameState: any = null;
  isGameOver: boolean = false;
  isPaused: boolean = false;
  winnerName: string = '';
  scores: any[] = [];
  isKeyboard: boolean = false;
  isMobile: boolean = false;
  /** Current client's player index (1-based). Set from query param; host=1, joiners from joinedRoom. */
  myPlayerIndex: number = 1;
  /** Leaderboard from MongoDB, shown on PAUSED overlay */
  leaderboard: any[] = [];
  /** True after leaderboard fetch has completed (so we don't show "No scores yet" while loading) */
  leaderboardLoaded: boolean = false;
  /** Toggle Controls Legend visibility in pause menu */
  showControlsLegend: boolean = false;
  /** True when in single-player (solo) mode – show leaderboard in pause only then */
  isSoloMode: boolean = false;
  /** True when in local multiplayer (host = spectator, controllers = no board) */
  isLocalMode: boolean = false;
  /** Show "Game ended" overlay when user chose End Game from menu (with final scores, Home/Replay) */
  showGameEndedByUser: boolean = false;
  /** True when playing Pong */
  isPongMode: boolean = false;
  /** Pong Game State */
  pongState: any = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    public socketService: SocketService
  ) { }

  ngOnInit(): void {
    this.roomCode = this.route.snapshot.paramMap.get('id') || '';
    this.route.queryParams.subscribe(params => {
      this.username = params['username'] || 'Anonymous';
      this.isHost = params['host'] === 'true';
      this.isKeyboard = params['kb'] === 'true';
      this.isMobile = !this.isKeyboard;
      this.myPlayerIndex = Number(params['playerIndex']) || 1;
      this.isSoloMode = params['mode']?.includes('solo');
      this.isLocalMode = params['mode']?.includes('local');
      this.isPongMode = params['mode']?.startsWith('pong');
    });

    this.socketService.on('roomStats').subscribe(data => {
      // If game hasn't started, we use roomStats to show players joining
      if (!this.gameState) {
        this.players = data.players.map((p: any) => ({
          ...p,
          board: Array.from({ length: 20 }, () => Array(10).fill(0)),
          score: 0
        }));
      }
    });

    this.socketService.on('gameState').subscribe(state => {
      this.gameState = state;
      this.players = Object.keys(state).map(key => ({
        id: Number(key.replace('p', '')) || key.replace('p', ''),
        ...state[key]
      }));
    });

    this.socketService.on('gameOver').subscribe(data => {
      this.winnerName = data.winnerName;
      this.scores = data.scores.sort((a: any, b: any) => b.score - a.score);
    });

    this.socketService.on('pongState').subscribe(state => {
      this.pongState = state;
      this.isPongMode = true; // Ensure it's set if we get Pong state
    });

    this.socketService.on('pongStarted').subscribe(() => {
      this.isGameOver = false;
      this.isPaused = false;
    });

    this.socketService.on('pongGameOver').subscribe(data => {
      this.isGameOver = true;
      if (data.soloWin) {
        this.winnerName = 'PRACTICE COMPLETE!';
      } else if (this.isSoloMode) {
        this.winnerName = 'GAME OVER';
      } else {
        const winner = this.pongState?.players.find((p: any) => p.side === data.side);
        this.winnerName = (winner ? (winner.username || winner.side.toUpperCase()) : 'UNKNOWN') + ' WINS!';
      }
      this.scores = this.pongState ? this.pongState.players.map((p: any) => ({ name: p.username || (p.side === 'left' ? 'LEFT' : 'RIGHT'), score: p.score })) : [];
    });

    this.socketService.on('gamePaused').subscribe(() => {
      console.log('Received gamePaused event');
      this.isPaused = true;
    });
    this.socketService.on('gameUnpaused').subscribe(() => {
      console.log('Received gameUnpaused event');
      this.isPaused = false;
    });
    this.socketService.on('readyToStart').subscribe(() => {
      this.isGameOver = false;
      this.isPaused = false;
    });

    this.socketService.on('gameRestarted').subscribe(() => {
      this.gameState = null;
      this.isGameOver = false;
      this.isPaused = false;
      this.showGameEndedByUser = false;
    });

    this.socketService.on('highScores').subscribe(data => {
      console.log('Received updated high scores from server');
      this.leaderboard = data.map((s: any) => ({ name: s.name ?? 'Anonymous', score: s.score ?? 0 }));
      this.leaderboardLoaded = true;
    });

    this.socketService.on('roomClosed').subscribe(() => this.router.navigate(['/']));

    this.startRenderingLoop();
  }

  // --- UI HELPER GETTERS ---

  /** True if we are waiting for players to ready up */
  get isWaiting(): boolean {
    if (this.isGameOver) return false;
    if (this.isPongMode) return !this.pongState?.started;
    return !this.gameState;
  }

  /** True if the game is currently active */
  get isPlaying(): boolean {
    if (this.isGameOver) return false;
    if (this.isPongMode) return !!this.pongState?.started;
    return !!this.gameState;
  }

  /** Show "Press Enter to Ready" hint */
  get showReadyHint(): boolean {
    return this.isWaiting && (this.isKeyboard || !this.isMobile) && !this.isHost;
  }

  /** Show THE READY UP button */
  get showReadyButton(): boolean {
    return this.isWaiting && !(this.isLocalMode && this.isHost);
  }

  /** Show Host "Waiting for players" text */
  get showHostWaitMessage(): boolean {
    return this.isWaiting && (this.isLocalMode && this.isHost);
  }

  @ViewChild('pongCanvas') pongCanvas!: ElementRef<HTMLCanvasElement>;
  private animationFrameId: number | null = null;

  startRenderingLoop() {
    const render = () => {
      if (this.isPongMode && this.pongCanvas) {
        this.drawPong();
      }
      this.animationFrameId = requestAnimationFrame(render);
    };
    render();
  }

  drawPong() {
    const canvas = this.pongCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || !this.pongState) return;

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Center line
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Ball
    if (this.pongState.ball) {
      ctx.fillStyle = '#fff';
      const size = 12;
      ctx.fillRect(this.pongState.ball.x - size / 2, this.pongState.ball.y - size / 2, size, size);

      // Glow effect for ball
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#fff';
      ctx.fillRect(this.pongState.ball.x - size / 2, this.pongState.ball.y - size / 2, size, size);
      ctx.shadowBlur = 0;
    }

    // Draw Players (Paddles)
    this.pongState.players.forEach((p: any) => {
      ctx.fillStyle = p.side === 'left' ? '#00d2ff' : '#f5576c';
      const w = 12;
      const h = 80;
      const x = p.side === 'left' ? 30 - w / 2 : canvas.width - 30 - w / 2;
      ctx.fillRect(x, p.y - h / 2, w, h);
    });

    // Draw Walls (Solo Bricks)
    if (this.pongState.isSolo && this.pongState.walls) {
      ctx.fillStyle = '#FFD700';
      const bw = 20;
      const bh = 40;
      this.pongState.walls.forEach((w: any) => {
        ctx.fillRect(w.x - bw / 2, w.y - bh / 2, bw - 2, bh - 2);
      });
    }
  }

  /** Get leaderboard from backend (MongoDB) for pause overlay – only called in solo mode */
  loadLeaderboard(): void {
    if (!this.isSoloMode) return;
    this.leaderboardLoaded = false;
    const endpoint = this.isPongMode ? '/api/pong-scores' : '/api/scores';
    const fullUrl = `${this.socketService.baseUrl}${endpoint}`;
    console.log('Fetching leaderboard from:', fullUrl);
    this.http.get<any[]>(fullUrl).subscribe(
      (data) => {
        console.log('Leaderboard data received:', data);
        this.leaderboard = Array.isArray(data) ? data.map((s: any) => ({ name: s.name ?? 'Anonymous', score: s.score ?? 0 })) : [];
        this.leaderboardLoaded = true;
      },
      (err) => {
        console.error('Leaderboard fetch error:', err);
        this.leaderboard = [];
        this.leaderboardLoaded = true;
      }
    );
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (this.isGameOver) return;

    let action = '';
    switch (event.key) {
      case 'ArrowLeft': action = 'left'; break;
      case 'ArrowRight': action = 'right'; break;
      case 'ArrowDown': action = 'down'; break;
      case 'ArrowUp': action = 'rotate'; break;
      case ' ': action = 'drop'; break;
      case 'Escape':
        if (this.isPaused) this.socketService.emit('unpauseGame', this.roomCode);
        else this.socketService.emit('pauseGame', this.roomCode);
        return;
    }

    if (action) {
      if (this.isPongMode) {
        // Continuous movement for Pong
        if (action === 'rotate' || action === 'up') this.socketService.emit('pongInput', { roomCode: this.roomCode, type: 'up', pressed: true });
        if (action === 'down') this.socketService.emit('pongInput', { roomCode: this.roomCode, type: 'down', pressed: true });
      } else {
        this.socketService.emit('input', { roomCode: this.roomCode, action });
      }
    }

    if (event.key === 'Enter' && !this.isGameOver && (this.players.length > 0 || this.isPongMode)) {
      this.socketService.emit('playerReady', this.roomCode);
    }
  }

  @HostListener('window:keyup', ['$event'])
  handleKeyUp(event: KeyboardEvent) {
    if (!this.isPongMode || this.isGameOver) return;

    if (event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
      this.socketService.emit('pongInput', { roomCode: this.roomCode, type: 'up', pressed: false });
    }
    if (event.key === 'ArrowDown' || event.key === 's' || event.key === 'S') {
      this.socketService.emit('pongInput', { roomCode: this.roomCode, type: 'down', pressed: false });
    }
  }

  ready() {
    console.log('Player ready in room:', this.roomCode);
    this.socketService.emit('playerReady', this.roomCode);
  }

  pause() {
    console.log('Pausing game in room:', this.roomCode);
    this.loadLeaderboard();
    this.socketService.emit('pauseGame', this.roomCode);
  }

  resume() {
    this.isPaused = false;
    this.socketService.emit('unpauseGame', this.roomCode);
  }

  restart() {
    this.showGameEndedByUser = false;
    this.socketService.emit('restartGame', this.roomCode);
  }

  /** Single action per tap (avoids double fire from touch + click on phone) */
  sendInput(action: string, pressed: boolean = true) {
    if (this.isPongMode) {
      // Map mobile control actions to Pong
      const mapping: any = {
        'rotate': 'up',
        'up': 'up',
        'down': 'down'
      };
      const pongType = mapping[action] || action;
      if (pongType === 'up' || pongType === 'down') {
        this.socketService.emit('pongInput', { roomCode: this.roomCode, type: pongType, pressed });
      }
    } else {
      // Tetris: only fire on press
      if (pressed) {
        this.socketService.emit('input', { roomCode: this.roomCode, action });
      }
    }
  }

  goHome() {
    this.socketService.emit('leaveRoom', this.roomCode);
    this.router.navigate(['/']);
  }

  /** End Game from menu: show overlay with final scores, Home and Replay (don't navigate yet) */
  endGameFromMenu() {
    this.socketService.emit('endGameManual', this.roomCode);
    this.showGameEndedByUser = true;
    this.isPaused = false;
  }

  /** Final scores for "Game ended" overlay (from current game state) */
  get gameEndedScores(): { name: string; score: number }[] {
    if (this.players && this.players.length) {
      return [...this.players].map(p => ({ name: p.username || 'Anonymous', score: p.score ?? 0 })).sort((a, b) => b.score - a.score);
    }
    return [];
  }

  ngOnDestroy(): void {
    // Should handle cleanup but socket service is root
  }
}
