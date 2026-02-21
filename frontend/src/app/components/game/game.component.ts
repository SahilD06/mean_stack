import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
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
      const pi = params['playerIndex'];
      this.myPlayerIndex = pi !== undefined && pi !== null && pi !== '' ? +pi : 1;
      this.isSoloMode = params['mode'] === 'solo';
      this.isLocalMode = params['mode'] === 'local';
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
      this.isGameOver = true;
      this.winnerName = data.winnerName;
      this.scores = data.scores.sort((a: any, b: any) => b.score - a.score);
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

    this.socketService.on('roomClosed').subscribe(() => {
      this.router.navigate(['/']);
    });
  }

  /** Get leaderboard from backend (MongoDB) for pause overlay – only called in solo mode */
  loadLeaderboard(): void {
    if (!this.isSoloMode) return;
    this.leaderboardLoaded = false;
    this.http.get<any[]>(`${this.socketService.baseUrl}/api/scores`).subscribe(
      (data) => {
        this.leaderboard = Array.isArray(data) ? data.map((s: any) => ({ name: s.name ?? 'Anonymous', score: s.score ?? 0 })) : [];
        this.leaderboardLoaded = true;
      },
      () => {
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
      this.socketService.emit('input', { roomCode: this.roomCode, action });
    }

    if (event.key === 'Enter' && !this.isGameOver && Object.keys(this.players).length > 0) {
      this.socketService.emit('playerReady', this.roomCode);
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
  sendInput(action: string) {
    this.socketService.emit('input', { roomCode: this.roomCode, action });
  }

  goHome() {
    this.socketService.emit('leaveRoom', this.roomCode);
    this.router.navigate(['/']);
  }

  /** End Game from menu: show overlay with final scores, Home and Replay (don't navigate yet) */
  endGameFromMenu() {
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
