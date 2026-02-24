import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';
import { GameComponent } from './components/game/game.component';
import { LandingComponent } from './components/landing/landing.component';
import { PongHomeComponent } from './components/pong-home/pong-home.component';

const routes: Routes = [
  { path: '', component: LandingComponent },
  { path: 'tetris', component: HomeComponent },
  { path: 'pong', component: PongHomeComponent },
  { path: 'game/:id', component: GameComponent },
  { path: '**', redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
