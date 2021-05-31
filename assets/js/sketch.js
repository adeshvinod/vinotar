
let chords=[]     //array storing every inputed chord/arpeggio/scale in the progression 
let totalchords=0; //total chords inputed by user
let inputbars=[]; // bar-length values of respective chords   
let paintcanvas=[];  //array of paint canvas, each chord has a corresponding private canvas,navigation is same for canvas and chords


x_scale=0.85*window.outerWidth/1536; 
y_scale=x_scale;                // canvas scaling variables so that canvas accomodates to any screen size 
let xoff=15;       //offset values from x and y axis for buttons (SHOW MAP,<,>,+,-)
let yoff=600*y_scale;
let nav=0;        // direction of navigation. nav=1(forwards) nav=-1(reverse)
let mapmode=0;    //when mapmode==1, the fretboard maps all inputed notes across the neck

let c=0;            //index number of current chord[]
let prevc=0;        //index number of prev chord, if the current chord is the first chord, prevc will be the last chord inputed(cyclic navigation) 
let show_intervals=0;
let lerpamount=0    //index for linear interpolation during transition
let amount=0;       //below threshold value displays transition animation and above threshold displays static map  

let t1;
let stream_mode_var=0; //toggle green screen as background

let deletenote=0;
let shownote=1;   //displays note names, C,C#,D etc

var radius;       //radius of paintbrush stroke
var c_canv;       //color of paintbrush
let paintmode=0;     //double left click toggles paintmode

let button, button2,button3,button4,button5;

//variables concerning metronome
let timeNow;
let klack;   //metronome sound at beats 2,3,4
let pling;   //metronome sound at beat 1
let nextKlack = 0; //tells when next kalck sound will appear in milliseconds
let beats=-4;    //beats set to -4 initially, first 4 beats is just count in, transition animation will get affected by metronome only if beats>=0
let ismetronome=0; 
let metro_trans=0 //flag to ensure the transition function gets called only once during metronome shifting of chords

//variables concerning the chord progression navigation bar at the bottom
let x_barpos;
let y_barpos;
let showbars=1;  //showbar=0 hides the animation incase user wants more space for drawing

function preload() {
  klack = loadSound('assets/klack.wav');
  pling=loadSound('assets/pling.wav');
  klack.playMode('restart');
  pling.playMode('restart');

}

function setup() {
 createCanvas(wd,ht*1.5);
 back_col=color(0,0,0)   //color of background 
 frameRate(60);
if(wd<800)
alert("This App is meant to be used on laptop/desktop and not your mobile phone/tablet.If you still wish to continue with the ugly mobile UI, make sure you rotate your mobile to landscape mode and reload the page");
scale(x_scale,y_scale);
 
for(let i=0;i<50;i++)        //creates 50 EMPTY chords initially, so maximum chords in progression can only be 50
  {
    chords[i]=new chordclass();
  }
 
  colorMode(HSB,1)
  colorMode(RGB,255);  
  col=color(255,200,100,50)
  button=createButton('+');

  button.position(19+xoff,19+yoff);
  button.size(50,50);
  button.style('background-color', col);
  button.style('font-size','20px');
  button.style('font-family','lato');
  button.style('color','white');
  button.style('border-radius','12px');

 
  button2=createButton('SHOW MAP');
  button2.position(19+xoff,90+yoff);
  button2.style('font-family','lato');
  button2.size(150,70);
  button2.style('background-color', col);
  button2.style('font-size','20px');
  button2.style('color','white');
  button2.style('border-radius','12px');
  
  button3=createButton('>');
  button3.size(50,50);
  button3.style('background-color', col);
  button3.style('font-size','20px');
  button3.style('font-family','lato');
  button3.style('color','white');
  button3.position(120+xoff,19+yoff);
  button3.style('border-radius','12px');
   
  button5=createButton('<');
  button5.size(50,50);
  button5.style('background-color', col);
  button5.style('font-size','20px');
  button5.style('font-family','lato');
  button5.style('color','white');
  button5.position(70+xoff,19+yoff);
  button5.style('border-radius','12px');
  
  button_showintervals=createButton('color coded intervals');
  button_showintervals.position(120+xoff,410+yoff);
  button_showintervals.size(100,50);
  button_showintervals.style('background-color',col);
  button_showintervals.style('font-size','15px');
  button_showintervals.style('font-family','lato');
  button_showintervals.style('color','white');
  button_showintervals.style('border-radius','12px');
  
  button4=createButton('Start Again');
  button4.position(xoff+19,yoff+470)
  button4.size(200,70);
  button4.style('background-color',col)
  button4.style('font-size','20px')
  button4.style('font-family','lato')
  button4.style('color','white')
  button4.style('border-radius','12px');

  button6=createButton('Stream Mode');
  button6.position(xoff+19,yoff+410)
  button6.size(100,50);
  button6.style('background-color',col)
  button6.style('font-size','15px')
  button6.style('font-family','lato')
  button6.style('color','white')
  button6.style('border-radius','12px');

  button7=createButton('toggle metronome');
  button7.position(xoff+19,yoff+350)
  button7.size(100,50);
  button7.style('background-color',col)
  button7.style('font-size','15px')
  button7.style('font-family','lato')
  button7.style('color','white')
  button7.style('border-radius','12px');

  button8=createButton('-');                     //delete chord
  button8.position(xoff+170,yoff+19)
  button8.size(50,50);
  button8.style('background-color',col)
  button8.style('font-size','25px')
  button8.style('font-family','lato')
  button8.style('color','white')
  button8.style('border-radius','12px');
  

  tempoSlider = createSlider(40, 208, 100);
  tempoSlider.class('slider');
  tempoSlider.position(xoff+130,yoff+380);
  tempoSlider.hide();
  
  
  //PAINT CANVAS
for(let i=0;i<50;i++)             //similarly we create 50 paintcanvas and bar-length input bars that correspond to the 50 chords
{ 
  inputbars[i]=createInput(1,float);
  inputbars[i].position(0, 0);
  inputbars[i].size(30);
     
  paintcanvas[i]=createGraphics(wd,ht*1.5);
  paintcanvas[i].slider = createSlider(1, 20, 3);
  paintcanvas[i].slider.position(wd/1.2,10);
  paintcanvas[i].slider.hide();
  paintcanvas[i].eraser = createButton("clear");
  paintcanvas[i].eraser.mousePressed(changeBG);
  paintcanvas[i].eraser.position(wd/1.2,40);
  paintcanvas[i].eraser.hide();
  paintcanvas[i].eraser.style('border-radius','20%');
  paintcanvas[i].eraser.style('background-color','orange')
  paintcanvas[i].redbutton=createButton(".");
  paintcanvas[i].redbutton.mousePressed(redpaint);
  paintcanvas[i].redbutton.hide();
  paintcanvas[i].redbutton.position(wd/1.06,20);
  paintcanvas[i].redbutton.style('border-radius','50%');
  paintcanvas[i].redbutton.style('background-color','orange')

  paintcanvas[i].bluebutton=createButton(".");
  paintcanvas[i].bluebutton.mousePressed(bluepaint);
  paintcanvas[i].bluebutton.position(wd/1.08,40);
  paintcanvas[i].bluebutton.hide();
  paintcanvas[i].bluebutton.style('border-radius','50%');
  paintcanvas[i].bluebutton.style('background-color','magenta')

  paintcanvas[i].whitebutton=createButton(".");
  paintcanvas[i].whitebutton.mousePressed(whitepaint);
  paintcanvas[i].whitebutton.hide();
  paintcanvas[i].whitebutton.position(wd/1.08,0);
  paintcanvas[i].whitebutton.style('border-radius','50%');
  paintcanvas[i].whitebutton.style('background-color','white')
  
  paintcanvas[i].checkbox = createCheckbox('Eraser', false);
  paintcanvas[i].checkbox.position(wd/1.15,40)
  paintcanvas[i].checkbox.style('color','white')
  paintcanvas[i].checkbox.hide();
  
  colorMode(RGB);
    
  c_canv=color(255,255,255);
  paintcanvas[i].colorMode(RGB);
  paintcanvas[i].background(255,255,255,0); //alpha value=0 as overlaying paint canvas should be transparent. only strokes are opaque
  
   }
}




function draw() {
  window.onkeydown = function(e) { 
    return !(e.keyCode == 32); };             //prevent page scrolling when space is pressed, prevents default behaviour
 
   for(let i=0;i<chords.length;i++) //50 is the number of intial chords, initally hide all the unnecessary buttons
    {
      paintcanvas[i].slider.hide();
      paintcanvas[i].eraser.hide();
      paintcanvas[i].checkbox.hide();
      paintcanvas[i].redbutton.hide();
      paintcanvas[i].bluebutton.hide();
      paintcanvas[i].whitebutton.hide();
      inputbars[i].hide();
    }
  inputbars[c].show();  //only show the bar-length input bar for the current chord (c is the index of current chord)
  if (mapmode==0)
  {
  
    button.show();
    button2.show();
    button7.hide();
    tempoSlider.hide();
    button8.show();
  }
  else
  { button.hide();
    //button2.hide();
    button3.show();
    button5.show();
    button7.show();
    button8.hide();
    tempoSlider.show();
  }
  
  
  button.mousePressed(inputnextchord);
  button2.mousePressed(mapmode_funct);
  button3.mousePressed(shownextchord);
  button_showintervals.mousePressed(funct_showintervals);
  button4.mousePressed(startover);
  button5.mousePressed(showpreviouschord);
  button6.mousePressed(stream_mode);
  button7.mousePressed(togglemetronome)
  button8.mousePressed(deletechord_global)

  
 timeNow=millis();
if(mapmode!=1)  //edit mode
{ 
   chords[c].display_fretboard(); 
   chords[c].display_inputchord();
   chords[c].chordanalyze(); 
     
}
else       //map mode
{
    chords[c].display_fretboard();
    mapanimation();
    chords[c].chordanalyze();   
}
    chords[c].bars=inputbars[c].value();


if(paintmode==1)
{
 paintcanvas[c].slider.show();
 paintcanvas[c].eraser.show();
 paintcanvas[c].checkbox.show();
 paintcanvas[c].redbutton.show();
 paintcanvas[c].bluebutton.show();
 paintcanvas[c].whitebutton.show();
 radius = paintcanvas[c].slider.value();
 image(paintcanvas[c],0,0);
}
    

if(ismetronome==1 && mapmode==1){  //user can use the metronome only in map mode, not edit mode
  
     if (timeNow > nextKlack) {
       if(beats%4==0)
       pling.play();
       else
       klack.play();
       prevKlack = timeNow;
       nextKlack = timeNow + 60000/tempoSlider.value();
       beats++;
       nav=1;   //during transition, chords will change only in forward direction
       if(beats>0)
       metro_trans=1;    //flag to activate transition animation after count in
      
     }
  
    //to display metronome beat number
    push();
    textAlign(CENTER);
    textSize(20);
    colorMode(RGB);
    fill(255,255,255);
    if(beats<0)
    text(beats,200*x_scale,200*y_scale)
    else if((beats-1)%4+1==0)
    text(4,200*x_scale,200*y_scale);
    else
    text((beats-1)%4+1,200*x_scale,200*y_scale);
    pop();
  
  
    if(beats%(4*chords[c].bars)==0 && metro_trans==1 && timeNow>(prevKlack+30000/tempoSlider.value()))
    {               //this ensures transition happens only at the end of the bar
      amount=0;      
      prevc =c;     
      c=(c+1)%(totalchords+1); 
      metro_trans=0;  //reset the flag to 0 everytime, in case beats=-4 again (count in), we dont want this condition to be passed                 
      beats=0;      

    }
  }
   push();
   textAlign(CENTER);
   textSize(20);
   colorMode(RGB);
   fill(255,255,255);
   noStroke();
   if(mapmode==1)
   text(`${tempoSlider.value()}bpm`, (xoff+200),(yoff+360));   //disoplays metronome bpm value above the slider
   text(chords[c].chordname,(100)*x_scale,(250)*y_scale)     
   textSize(10);
   
   text("Bar Length",70,20)  //label for input bar(bar length input)
  pop();

 
 if(showbars==1)
 showprogression();   //displays the chord progression animation at bottom



}
  
function mouseClicked() {
 if(paintmode==1)  //mouse click behaviour is different in paint mode and non-paint mode. 
 {
  
   
    if (paintcanvas[c].checkbox.checked()) //if eraser is activated
     { 
       paintcanvas[c].erase();
      stampRectangle(255);
      paintcanvas[c].noErase();
     }
   
  }
  else{
    if(mapmode==0){     //chords can be edited only in input mode
    let x=mouseX;
    let y=mouseY;
      if (mouseY>270*y_scale && mouseY<920*y_scale)  //to check if mouse is in vicinity of fretboard
      {
       loop1:
        for (let i=0;i<6;i++)  //string number
        {   loop2: 
            for(let j=0;j<=18;j++) //fret numbr
            { 
              if((x-chords[c].fretobj[i][j].f_pos<chords[c].fretobj[i][j].f_width)&&(abs((y-(300*y_scale+i*50*y_scale)))<10) && ((x-chords[c].fretobj[i][j].f_pos)>0))
             {                       //conditional to check if the centre of fret is clicked
               if(!keyIsDown(SHIFT)) //deactivated rootnote changing mode
                {
                  let v= createVector(i,j);

                  if(keyIsDown(UP_ARROW))
                  { for(let m=0;m<6;m++)
                    {
                      for(let n=0;n<=18;n++)
                      {
                        if(chords[c].fretobj[i][j].note_intval==chords[c].fretobj[m][n].note_intval)
                        {
                          chords[c].fretobj[m][n].isdisable=(chords[c].fretobj[m][n].isdisable+1)%2;
                        }
                      }
                    }
                    
                  }
                else
                {
                  
                  loop3:
                  for( let q in chords[c].inputnotes)
                  {
                     if(chords[c].inputnotes[q].x==v.x && chords[c].inputnotes[q].y==v.y) //to check if note is already present, if yes, - note
                     { chords[c].fretobj[i][j].input_chordnote=0;
                      chords[c].fretobj[i][j].present=0;
                       chords[c].inputnotes.splice(q,1); 
                       chords[c].total_chordnotes--; 

                      for(let r in chords[c].chordnotes)
                      {  
                        if(chords[c].chordnotes[chords[c].chordnotes.length-r-1]==chords[c].fretobj[i][j].note_intval) 
                        { //we must delete elements in chordnotes[] from the back as the computer treats 0th element as root.otherwise, if user deletes a repeated inputed root, the root note value will change
                          chords[c].chordnotes.splice(chords[c].chordnotes.length-r-1,1); 
                          break;       //break out so that deletion of repeated notes does not affect the original note             
                        }
                    
                      }
                      break loop2;    
                     }
                  }
               
                  chords[c].inputnotes[chords[c].total_chordnotes]= v;
               
                  chords[c].fretobj[i][j].input_chordnote=1;
                  chords[c].chordnotes.push(chords[c].fretobj[i][j].note_intval);
                  chords[c].total_chordnotes++;
                            
                 }//when d is not held down

                }//condition for left mouse click
                else if(keyIsDown(SHIFT)){
                chords[c].rootchange(chords[c].fretobj[i][j].note_intval);
                //console.log("right mouse clicked");
                }
         
   
                
              
             }
            } //j loop
        } // i loop
      } // within fretboardcanvas 
  
} //condition for mapmode
} //condition for paintmode==0
}





function mouseDragged() {  //this function is for drawing on paintcanvas
if(paintmode==1)
{

if(!keyIsDown(SHIFT))
{  //universal paint,holding down shift and drawing ensures the drawing is universal for all canvas and not only for current canvas
  if(paintcanvas[c].checkbox.checked())
  {
    paintcanvas[c].erase();
    paintcanvas[c].rect(mouseX,mouseY,paintcanvas[c].slider.value(),paintcanvas[c].slider.value());
    paintcanvas[c].noErase();
  }else{
      paintcanvas[c].stroke(c_canv)
    }
    paintcanvas[c].strokeWeight(paintcanvas[c].slider.value());
    paintcanvas[c].line(mouseX, mouseY, pmouseX, pmouseY);
}

   else if(keyIsDown(SHIFT))
   {
     for(let p=0;p<=50;p++)
     {
      if (paintcanvas[p].checkbox.checked()){
        
        paintcanvas[p].erase();
        paintcanvas[p].rect(mouseX,mouseY,paintcanvas[p].slider.value(),paintcanvas[p].slider.value());
        paintcanvas[p].noErase();
      }else{
        paintcanvas[p].stroke(c_canv)
      }
        paintcanvas[p].strokeWeight(paintcanvas[p].slider.value());
        paintcanvas[p].line(mouseX, mouseY, pmouseX, pmouseY);
    
     }
   }

 }
}


function changeBG() {
  //paintcanv.background(255);
  paintcanvas[c].clear();
  //ColorPicker()
}



function stampRectangle(c_canv,c_=c){
  paintcanvas[c_].fill(c_canv)
  paintcanvas[c_].noStroke();

  paintcanvas[c_].rect(mouseX,mouseY,paintcanvas[c_].slider.value(),paintcanvas[c_].slider.value())
}




function mapanimation(){
  
  if(ismetronome==1)
  amount=amount+1/(frameRate()*30/tempoSlider.value());   //incrementing amount in order to fit perfectly between transition from end of last bar to to start of next
  else 
  amount=amount+0.025;
  if(amount>1)
  chords[c].display_fullchord();
  else
  { 
    if(beats>=0 && ismetronome==1)             //to ensure that transition animation does not happen during count in
   transition(amount);
    else if(ismetronome==0)
    transition(amount);
  }
 
  
}

function shownextchord(){
 
  
  if(mapmode==1) //we want nav to change only during map mode
   nav=1;
   amount=0;
   prevc =c;     
   c=(c+1)%(totalchords+1);
   
}

function showpreviouschord()
{
   if(mapmode==1)
   nav=-1;
   amount=0;
   prevc=c;
   c=c-1;
   if(c<0)
   {c=totalchords;
   }
   
}


function transition(tempamount){

  
  colorMode(HSB,1);
  fill(60/360,1,1,0.8);
  noStroke();
  let radii=40*x_scale;

  for(let i=0;i<6;i++)
    { for(let j=0;j<18;j++)
      {  
        

           if(nav==1)
           {
             if(chords[prevc].fretobj[i][j].iscommon_f==1)
             {
              let x1=chords[c].fretobj[i][j].loc.x;       
              let x2=chords[c].fretobj[i][j].loc.y; 
              ellipse(x1,x2,radii,radii);
              continue;           
             }

             if(chords[c].fretobj[i][j].arise_f==1){
              let loneradii=map(amount,0,1,0,radii);
              let lonex=chords[c].fretobj[i][j].loc.x;
              let loney=chords[c].fretobj[i][j].loc.y;
              ellipse(lonex,loney,loneradii,loneradii)
              continue;

             }
             if(chords[prevc].fretobj[i][j].collapse_f==1)
             {
              let loneradii=map(amount,0,1,radii,0);
              let lonex=chords[prevc].fretobj[i][j].loc.x;
              let loney=chords[prevc].fretobj[i][j].loc.y;
              ellipse(lonex,loney,loneradii,loneradii);
              
             }
             
             if(chords[prevc].fretobj[i][j].islerpfrom==1)
            {
             let v1=createVector(chords[c].fretobj[i][j].loc.x,chords[c].fretobj[i][j].loc.y);
             let v2=createVector(chords[c].fretobj[i][chords[prevc].fretobj[i][j].lerp_destination].loc.x,chords[c].fretobj[i][chords[prevc].fretobj[i][j].lerp_destination].loc.y);
             let v3 = p5.Vector.lerp(v1, v2, tempamount);
             ellipse(v3.x,v3.y,radii,radii);
            }

    

           }
           else if(nav==-1)
           {
            if(chords[prevc].fretobj[i][j].iscommon_b==1)
            {
             let x1=chords[c].fretobj[i][j].loc.x;       
             let x2=chords[c].fretobj[i][j].loc.y; 
             ellipse(x1,x2,radii,radii);
             continue;           
            }

            if(chords[c].fretobj[i][j].arise_b==1){
             let loneradii=map(amount,0,1,0,radii);
             let lonex=chords[c].fretobj[i][j].loc.x;
             let loney=chords[c].fretobj[i][j].loc.y;
             ellipse(lonex,loney,loneradii,loneradii)
             continue;

            }
            if(chords[prevc].fretobj[i][j].collapse_b==1)
            {
             let loneradii=map(amount,0,1,radii,0);
             let lonex=chords[prevc].fretobj[i][j].loc.x;
             let loney=chords[prevc].fretobj[i][j].loc.y;
             ellipse(lonex,loney,loneradii,loneradii);
             
            }
            
            if(chords[prevc].fretobj[i][j].islerpto==1)
           {
             for(let o of chords[prevc].fretobj[i][j].lerp_origin)
           { let v1=createVector(chords[c].fretobj[i][j].loc.x,chords[c].fretobj[i][j].loc.y);
            let v2=createVector(chords[c].fretobj[i][o].loc.x,chords[c].fretobj[i][o].loc.y);
            let v3 = p5.Vector.lerp(v1,v2, tempamount);
            ellipse(v3.x,v3.y,radii,radii);
           }
           }
     
           }
      }
    }
  

} 
function mapmode_funct()
{
  if(mapmode==1)
{
 for(temp1=0;temp1<=totalchords;temp1++)  //loops through the chords
  {
    chords[temp1].reset_lerp();
    
  }
}
  mapmode=(mapmode+1)%2;
  if(mapmode==0)
  ismetronome=0;
  beats=-4;

 //c=0;
prevc=c;
nav=0;
  button.hide()
 // button.show();

 if(mapmode==1)
 {

 for(temp1=0;temp1<=totalchords;temp1++)
 { 
   temp2_f=(temp1+1)%(totalchords+1);
   if(temp1==0)
   temp2_b=totalchords;
   else 
   temp2_b=temp1-1;

  for(let i=0;i<6;i++)
    { for(let j=0;j<18;j++)
      {                
        if(chords[temp1].fretobj[i][j].present==1&&chords[temp2_f].fretobj[i][j].present==1&&chords[temp1].fretobj[i][j].isdisable==0&&chords[temp2_f].fretobj[i][j].isdisable==0)
        { //constant bubbles   
              chords[temp1].fretobj[i][j].iscommon_f=1;
              chords[temp2_f].fretobj[i][j].iscommon_b=1;
              
        }
      }
    }
 }
 for(temp1=0;temp1<=totalchords;temp1++)
 { 
   temp2_f=(temp1+1)%(totalchords+1);
   if(temp1==0)
   temp2_b=totalchords;
   else 
   temp2_b=temp1-1;

  for(let i=0;i<6;i++)
    { for(let j=0;j<18;j++)
      {  

        
      if(chords[temp1].fretobj[i][j].present==1 &&chords[temp1].fretobj[i][j].iscommon_f==0&&chords[temp1].fretobj[i][j].isdisable==0) //we want all constant nodes to remain untouched 
      {
        let priority1,priority2,priority3,priority4;//records fret no(k) 
        let prionum=[]; 
        prionum.push(5); //default assumes node collapse

        for(let k=0;k<18;k++)
        {
          if(k==j)continue;

          if(chords[temp2_f].fretobj[i][k].present==1&&chords[temp2_f].fretobj[i][k].isdisable==0)
          {
            if(k-j==1&&chords[temp2_f].fretobj[i][k].iscommon_b==0)
            {priority1=k;               
             prionum.push(1);      
            }
           else if(k-j==-1&&chords[temp2_f].fretobj[i][k].iscommon_b==0)
           {
             priority2=k;                 
             prionum.push(2);                   
           }
           else if(k-j==2&&chords[temp2_f].fretobj[i][k].iscommon_b==0)
            { priority3=k;               
             prionum.push(3)                 
            }
           else if(k-j==-2&&chords[temp2_f].fretobj[i][k].iscommon_b==0)
            { priority4=k;                
             prionum.push(4);              
            }
            
          }

         
        }
        prionum.sort();
        let highpri=prionum[0];  //highest priority( indicated by smallest number)

        if(highpri==1)
             { chords[temp1].fretobj[i][j].lerp_destination=priority1;
               chords[temp2_f].fretobj[i][priority1].lerp_origin.push(j);
              

              
               chords[temp2_f].fretobj[i][priority1].islerpto=1;
               chords[temp1].fretobj[i][j].islerpfrom=1;
             }
           else if(highpri==2)
             {  chords[temp1].fretobj[i][j].lerp_destination=priority2;
              chords[temp2_f].fretobj[i][priority2].lerp_origin.push(j);
             

             
              chords[temp2_f].fretobj[i][priority2].islerpto=1;
              chords[temp1].fretobj[i][j].islerpfrom=1;
             }
           else if(highpri==3)
             {
              chords[temp1].fretobj[i][j].lerp_destination=priority3;
              chords[temp2_f].fretobj[i][priority3].lerp_origin.push(j);
             

             
              chords[temp2_f].fretobj[i][priority3].islerpto=1;
              chords[temp1].fretobj[i][j].islerpfrom=1;
             }
            else if(highpri==4)
              {
                chords[temp1].fretobj[i][j].lerp_destination=priority4;
                chords[temp2_f].fretobj[i][priority4].lerp_origin.push(j);
               
  
               
                chords[temp2_f].fretobj[i][priority4].islerpto=1;
                chords[temp1].fretobj[i][j].islerpfrom=1;
              }
           else
             {
              chords[temp1].fretobj[i][j].collapse_f=1;
              chords[temp1].fretobj[i][j].arise_b=1
             }
          // console.log("    "+prionumarray)
           prionum.length=0;
            }// if statement checking if node is present in temp1
        
      

        

        



      } //j loop
    }//i loop
    
  }//temp1 loop

  for(temp1=0;temp1<=totalchords;temp1++)  //loops through the chords
 { 
   temp2_f=(temp1+1)%(totalchords+1);  //temp2_f represents the next chord while temp2_b represent the previous chorf
   if(temp1==0)
   temp2_b=totalchords;
   else 
   temp2_b=temp1-1;

  for(let i=0;i<6;i++)
    { for(let j=0;j<18;j++)
      {                

        if((chords[temp1].fretobj[i][j].present==1)&&(chords[temp1].fretobj[i][j].islerpto==0)&&chords[temp1].fretobj[i][j].isdisable==0)
        {
          chords[temp1].fretobj[i][j].arise_f=1;
          chords[temp1].fretobj[i][j].collapse_b=1;
        }
      }
    }
 }
}//if conditional to check if we are in edit mode

  
}


function keyPressed() {
    if(key=='f')
    fullscreen(1);
  
  //if (mapmode==1)
   // {
      if(4==LEFT_ARROW)
      {  showpreviouschord();
        
    
      } 
      if(keyCode==RIGHT_ARROW)
        { shownextchord();
        }
      
      //}
    

    
   if(key=='p')
     {
       if(paintmode==0)
        paintmode=1;
      else 
        paintmode=0;
     }
   
  
     if (keyCode===32)
     {
       mapmode_funct();
       
     }  

     if(key=='n')
     {
       shownote=(shownote+1)%2;
     }

     if(key=='m')
     {
       if(mapmode==1)
       togglemetronome();
     }

     if (key=='b')
     showbars=(showbars+1)%2;

     if(keyCode==13)
     {if(mapmode==0)
      inputnextchord();
     }

     



   
     

  

}

function doubleClicked()
{
  if(paintmode==0)
        paintmode=1;
      else 
        paintmode=0;
}


function inputnextchord()
{ 
  if(c!=totalchords)
  {chords.splice(c+1,0,chords[40])
   paintcanvas.splice(c+1,0,paintcanvas[40])
   inputbars.splice(c+1,0,inputbars[40])
   totalchords++;
   c=c+1
  }
  else{
 totalchords++;
 c=totalchords; 
  } 
}

function deletechord_global()
{ if(totalchords!=0)
  {//chords[c].deletechord();
    chords.splice(c,1);
    paintcanvas[c].slider.hide();
    paintcanvas[c].eraser.hide();
    paintcanvas[c].checkbox.hide();
    paintcanvas[c].redbutton.hide();
    paintcanvas[c].bluebutton.hide();
    paintcanvas[c].whitebutton.hide();
    inputbars[c].hide();
    paintcanvas.splice(c,1);
    inputbars.splice(c,1);
  if(c==totalchords)
  {c--;}
  totalchords--;
  
  } 
}

 

function funct_showintervals(){
  show_intervals=(show_intervals+1)%2;
}

function myInputEvent() {
  //console.log('you are typing: ', this.value());
}

function startover()
{
  for(let i=0;i<10;i++)
    {
      paintcanvas[i].clear();
      inputbars[i].value(1);
    }
  mapmode=0;
  chords.length=0;
  totalchords=0;
  beats=-4;
  c=0;
  prevc=0;
  for(let i=0;i<15;i++)
  {
    chords[i]=new chordclass();
  }
  button.show();

  ismetronome=0; 
}



function stream_mode()
{
  stream_mode_var=(stream_mode_var+1)%2;
  colorMode(RGB);
  if(stream_mode_var==1)
  {
    back_col=color(0,255,0);

  }
  else 
  back_col=color(0,0,0);
}


function togglemetronome()
{ metro_trans=0;                 
  beats=-4;    
  nextKlack = timeNow + 60000/tempoSlider.value();
  ismetronome=(ismetronome+1)%2;
}

function redpaint()
{
  push()
  colorMode(RGB);
 c_canv=color(255,140,0);
  pop();
}

function bluepaint()
{
  push();
  colorMode(RGB);
  c_canv=color(255,0,255);
  pop();

}

function whitepaint()
{
  push();
  colorMode(RGB);
  c_canv=color(255,255,255);
  pop();
}

function showprogression(){
  //location coordinated of of bars
  x_barpos=900*x_scale;
  y_barpos=650*y_scale;
  let barlength=130*x_scale;
  for(let i=0;i<=totalchords;i++)
  {
    if(x_barpos>=900*x_scale+130*x_scale*4)
    { x_barpos=900*x_scale;
      y_barpos=y_barpos+60*y_scale;
    }
      push();
      colorMode(HSB,1)
      fill(120/360,300/360,300/360,0.3);
      if(i==c)
      {
        strokeWeight(3);
        stroke(0,0,1);
      }
      else
      noStroke();
      barlength=130*chords[i].bars*x_scale;
      rect(x_barpos,y_barpos,barlength,50*x_scale,20,20,20,20);
      textAlign(CENTER);
      textSize(15*x_scale);
   
   fill(0,0,1);
   noStroke();
   
   text(chords[i].chordname,x_barpos+50*x_scale,y_barpos+20*y_scale)

      x_barpos=x_barpos+130*chords[i].bars*x_scale;
      pop();
      //console.log(x_barpos);
  }
}
