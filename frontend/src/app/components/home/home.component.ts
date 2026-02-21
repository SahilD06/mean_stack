import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SocketService } from '../../services/socket.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
  username: string = 'Anonymous';
  roomCode: string = '';
  activeMenu: string | null = null;

  constructor(private socketService: SocketService, private router: Router) { }

  toggleMenu(menu: string) {
    this.activeMenu = this.activeMenu === menu ? null : menu;
  }

  ngOnInit(): void {
    this.socketService.on('roomCreated').subscribe((code: string) => {
      const playerIndex = this.lastMode === 'local' ? 0 : 1;
      this.router.navigate(['/game', code], {
        queryParams: { host: true, username: this.username, kb: this.lastKbSelected, playerIndex, mode: this.lastMode }
      });
    });

    this.socketService.on('joinedRoom').subscribe((data: any) => {
      this.router.navigate(['/game', data.roomCode], {
        queryParams: { username: this.username, kb: this.lastKbSelected, playerIndex: data.playerIndex || 1, mode: data.mode || '' }
      });
    });

    this.socketService.on('error').subscribe((msg: string) => {
      alert(msg);
    });
  }

  private lastKbSelected: boolean = false;
  private lastMode: string = '';

  createRoom(mode: string, kb: boolean = false) {
    this.lastKbSelected = kb;
    this.lastMode = mode;
    this.socketService.emit('createRoom', { mode, username: this.username, integrated: true });
  }

  joinRoom(kb: boolean = false) {
    if (this.roomCode) {
      this.lastKbSelected = kb;
      this.socketService.emit('joinRoom', this.roomCode, this.username);
    }
  }
}
